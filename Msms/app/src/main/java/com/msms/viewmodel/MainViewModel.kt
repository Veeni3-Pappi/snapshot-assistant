package com.msms.viewmodel

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.msms.model.Contact
import com.msms.model.SimInfo
import com.msms.model.SmsEngineUiState
import com.msms.repository.ContactRepository
import com.msms.repository.SimRepository
import com.msms.service.SmsService
import com.msms.util.RecipientsFileStore
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class MainViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val contactRepository: ContactRepository,
    private val simRepository: SimRepository,
) : ViewModel() {

    private val _contacts = MutableStateFlow<List<Contact>>(emptyList())
    val contacts = _contacts.asStateFlow()

    private val _excludedPhones = MutableStateFlow<Set<String>>(emptySet())
    val excludedPhones = _excludedPhones.asStateFlow()

    val activeRecipients: StateFlow<List<Contact>> =
        combine(_contacts, _excludedPhones) { all, excluded ->
            all.filter { it.phoneNumber !in excluded }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _sims = MutableStateFlow<List<SimInfo>>(emptyList())
    val sims = _sims.asStateFlow()

    private val _selectedSim = MutableStateFlow<SimInfo?>(null)
    val selectedSim = _selectedSim.asStateFlow()

    private val _message = MutableStateFlow("")
    val message = _message.asStateFlow()

    private val _engineUiState = MutableStateFlow(SmsEngineUiState())
    val engineUiState = _engineUiState.asStateFlow()

    private var smsService: SmsService? = null
    private var bindRegistered = false
    private var engineCollectJob: Job? = null

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as SmsService.SmsBinder
            smsService = binder.getService()
            bindRegistered = true
            engineCollectJob?.cancel()
            engineCollectJob = viewModelScope.launch {
                smsService?.uiState?.collect { _engineUiState.value = it }
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            engineCollectJob?.cancel()
            engineCollectJob = null
            smsService = null
            _engineUiState.value = SmsEngineUiState()
        }
    }

    init {
        val intent = Intent(appContext, SmsService::class.java)
        bindRegistered = appContext.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
    }

    fun loadContacts() {
        viewModelScope.launch {
            runCatching { contactRepository.getAllContacts() }
                .onSuccess { _contacts.value = it }
                .onFailure { /* keep empty; UI should surface permission issues */ }
        }
    }

    fun loadSims() {
        val available = runCatching { simRepository.getActiveSimCards() }.getOrDefault(emptyList())
        _sims.value = available
        if (_selectedSim.value == null && available.isNotEmpty()) {
            _selectedSim.value = available.first()
        }
    }

    fun selectSim(sim: SimInfo) {
        _selectedSim.value = sim
    }

    fun updateMessage(value: String) {
        _message.value = value
    }

    fun setExcluded(phones: Set<String>) {
        _excludedPhones.value = phones
    }

    fun toggleExcluded(phone: String) {
        _excludedPhones.update { current ->
            if (phone in current) current - phone else current + phone
        }
    }

    fun clearExclusions() {
        _excludedPhones.value = emptySet()
    }

    fun excludeAll() {
        _excludedPhones.value = _contacts.value.map { it.phoneNumber }.toSet()
    }

    fun startSending(delayMs: Long) {
        val recipients = activeRecipients.value
        val msg = _message.value.trim()
        val sim = _selectedSim.value ?: return
        if (recipients.isEmpty() || msg.isBlank()) return

        val file = RecipientsFileStore.write(appContext, recipients)
        val intent = Intent(appContext, SmsService::class.java).apply {
            action = SmsService.ACTION_START
            putExtra(SmsService.EXTRA_RECIPIENTS_FILE, file.absolutePath)
            putExtra(SmsService.EXTRA_MESSAGE, msg)
            putExtra(SmsService.EXTRA_SUB_ID, sim.subscriptionId)
            putExtra(SmsService.EXTRA_DELAY_MS, delayMs)
        }
        ContextCompat.startForegroundService(appContext, intent)
    }

    fun pauseSending() {
        smsService?.pauseSending()
            ?: appContext.startService(Intent(appContext, SmsService::class.java).apply { action = SmsService.ACTION_PAUSE })
    }

    fun resumeSending() {
        smsService?.resumeSending()
            ?: appContext.startService(Intent(appContext, SmsService::class.java).apply { action = SmsService.ACTION_RESUME })
    }

    fun stopSending() {
        smsService?.stopSending()
            ?: appContext.startService(Intent(appContext, SmsService::class.java).apply { action = SmsService.ACTION_STOP })
    }

    fun clearLogs() {
        smsService?.clearLogs()
    }

    override fun onCleared() {
        if (bindRegistered) {
            runCatching { appContext.unbindService(serviceConnection) }
        }
        super.onCleared()
    }
}
