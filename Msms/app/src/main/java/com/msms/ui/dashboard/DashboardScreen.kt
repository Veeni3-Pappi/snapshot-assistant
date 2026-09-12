package com.msms.ui.dashboard

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.msms.model.SmsEnginePhase
import com.msms.util.SmsEncoding
import com.msms.viewmodel.MainViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    viewModel: MainViewModel,
    onOpenPreview: () -> Unit,
) {
    val context = LocalContext.current
    val activeRecipients by viewModel.activeRecipients.collectAsStateWithLifecycle()
    val sims by viewModel.sims.collectAsStateWithLifecycle()
    val selectedSim by viewModel.selectedSim.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    val engine by viewModel.engineUiState.collectAsStateWithLifecycle()

    var delaySeconds by rememberSaveable { mutableFloatStateOf(3f) }
    var customDelayText by rememberSaveable { mutableStateOf("") }
    var useCustomDelay by rememberSaveable { mutableStateOf(false) }

    var showSettingsDialog by remember { mutableStateOf(false) }
    // Track whether we've already asked for permissions this session
    var permissionsRequested by rememberSaveable { mutableStateOf(false) }
    // Track live permission state so UI recomposes when returning from Settings
    var permissionsGranted by rememberSaveable { mutableStateOf(false) }

    val permissions = remember {
        buildList {
            add(Manifest.permission.READ_CONTACTS)
            add(Manifest.permission.SEND_SMS)
            add(Manifest.permission.READ_PHONE_STATE)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    fun checkAllGranted(): Boolean = permissions.all {
        ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        permissionsRequested = true
        if (result.values.all { it }) {
            permissionsGranted = true
            viewModel.loadContacts()
            viewModel.loadSims()
        } else {
            permissionsGranted = false
            showSettingsDialog = true
        }
    }

    LaunchedEffect(Unit) {
        val granted = checkAllGranted()
        permissionsGranted = granted
        if (granted) {
            viewModel.loadContacts()
            viewModel.loadSims()
        }
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                val granted = checkAllGranted()
                permissionsGranted = granted
                if (granted) {
                    viewModel.loadContacts()
                    viewModel.loadSims()
                }
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val busy = engine.phase == SmsEnginePhase.Sending || engine.phase == SmsEnginePhase.Paused || engine.phase == SmsEnginePhase.Queuing
    val dashboardScroll = rememberScrollState()

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text("MSMS Control Center", fontWeight = FontWeight.SemiBold) },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                ),
            )
        },
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .padding(innerPadding)
                .fillMaxSize()
                .verticalScroll(dashboardScroll)
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (!permissionsGranted) {
                if (!permissionsRequested) {
                    // First time: show education card with system dialog trigger
                    PermissionEducationCard(
                        onContinue = { permissionLauncher.launch(permissions.toTypedArray()) },
                    )
                } else {
                    // Already asked once: direct user to Settings instead of looping
                    PermissionSettingsCard(
                        onOpenSettings = {
                            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                                data = Uri.fromParts("package", context.packageName, null)
                            }
                            context.startActivity(intent)
                        },
                        onRetry = { permissionLauncher.launch(permissions.toTypedArray()) },
                    )
                }
            }

            // Status row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                StatusCard(
                    title = "Recipients",
                    value = "${activeRecipients.size}",
                    subtitle = if (activeRecipients.isEmpty()) "Tap Recipient tab" else "Ready to send",
                    icon = Icons.Outlined.CheckCircle,
                    modifier = Modifier.weight(1f),
                    containerColor = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer
                )
                StatusCard(
                    title = "Engine Phase",
                    value = engine.phase.name,
                    subtitle = if (busy) {
                        when (engine.phase) {
                            SmsEnginePhase.Queuing -> "Queuing ${engine.queued}/${engine.total}"
                            else -> "${(engine.progress01 * 100).toInt()}% complete"
                        }
                    } else "Idle",
                    icon = Icons.Default.Info,
                    modifier = Modifier.weight(1f),
                    containerColor = MaterialTheme.colorScheme.tertiaryContainer,
                    contentColor = MaterialTheme.colorScheme.onTertiaryContainer
                )
            }

            // SIM Selection Card
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("SIM Selection", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    
                    if (sims.isEmpty()) {
                        Text(
                            "No active subscriptions detected. Grant phone state permission and ensure a SIM/eSIM is active.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    } else {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            sims.forEach { sim ->
                                FilterChip(
                                    selected = selectedSim?.subscriptionId == sim.subscriptionId,
                                    onClick = { if (!busy) viewModel.selectSim(sim) },
                                    enabled = !busy,
                                    label = { Text(sim.displayName, maxLines = 1) },
                                    leadingIcon = if (selectedSim?.subscriptionId == sim.subscriptionId) {
                                        { Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(18.dp)) }
                                    } else null,
                                )
                            }
                        }
                        selectedSim?.let { sim ->
                            Text(
                                "Carrier: ${sim.carrierName.ifBlank { "Unknown" }} • SIM ${sim.slotIndex + 1}" +
                                    if (sim.number.isNotBlank()) " • Line: ${sim.number}" else "",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            // Message Input
            val (chars, segments) = SmsEncoding.calculateSegments(message)
            OutlinedTextField(
                value = message,
                onValueChange = { viewModel.updateMessage(it) },
                label = { Text("SMS Body") },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 160.dp),
                minLines = 5,
                shape = RoundedCornerShape(16.dp),
                enabled = !busy || engine.phase == SmsEnginePhase.Paused,
                supportingText = {
                    Text("$chars characters • $segments SMS segment(s)", fontWeight = FontWeight.Medium)
                },
                isError = message.isBlank() && busy,
            )

            // Delay Card
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text("Throttle & Delay", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    
                    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                        SegmentedButton(
                            selected = !useCustomDelay,
                            onClick = { useCustomDelay = false },
                            shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                            enabled = !busy
                        ) { Text("Slider") }
                        SegmentedButton(
                            selected = useCustomDelay,
                            onClick = { useCustomDelay = true },
                            shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                            enabled = !busy
                        ) { Text("Custom") }
                    }

                    if (!useCustomDelay) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Slider(
                                value = delaySeconds,
                                onValueChange = { delaySeconds = it },
                                valueRange = 1f..30f,
                                steps = 28,
                                enabled = !busy,
                                modifier = Modifier.weight(1f)
                            )
                            Spacer(Modifier.width(16.dp))
                            Text(
                                "${delaySeconds.toInt()}s",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.width(40.dp)
                            )
                        }
                    } else {
                        OutlinedTextField(
                            value = customDelayText,
                            onValueChange = { customDelayText = it.filter { ch -> ch.isDigit() } },
                            label = { Text("Seconds (1–600)") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(12.dp)
                        )
                    }
                }
            }

            // Engine Progress
            AnimatedVisibility(visible = busy || engine.total > 0, enter = expandVertically(), exit = shrinkVertically()) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text("Engine Progress", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer)
                            Text("${(engine.progress01 * 100f).toInt()}%", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                        }
                        
                        LinearProgressIndicator(
                            progress = { engine.progress01 },
                            modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)),
                            strokeCap = StrokeCap.Round,
                            color = MaterialTheme.colorScheme.primary,
                            trackColor = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.2f)
                        )
                        
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            if (engine.queued > 0) {
                                Text("Queued: ${engine.queued}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
                            }
                            Text("Sent: ${engine.sent}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
                            Text("Failed: ${engine.failed}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error)
                            Text("Total: ${engine.total}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
                        }
                        
                        val cur = engine.currentPhone
                        if (!cur.isNullOrBlank()) {
                            Surface(
                                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.5f),
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    "Now sending: ${engine.currentName ?: "Unknown"} • $cur",
                                    style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier.padding(8.dp),
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }
                        engine.lastError?.let {
                            Text("Last error: $it", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }

            // Controls
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (!busy) {
                    Button(
                        onClick = {
                            val delayMs = if (useCustomDelay) {
                                (customDelayText.toLongOrNull() ?: 3L).coerceIn(1L, 600L) * 1000L
                            } else {
                                (delaySeconds * 1000f).toLong().coerceAtLeast(250L)
                            }
                            viewModel.startSending(delayMs)
                        },
                        modifier = Modifier.weight(1f).height(56.dp),
                        enabled = message.isNotBlank() && selectedSim != null && activeRecipients.isNotEmpty() && permissionsGranted,
                        shape = RoundedCornerShape(16.dp)
                    ) {
                        Icon(Icons.Default.Send, contentDescription = null)
                        Spacer(Modifier.width(12.dp))
                        Text("START SENDING", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    }
                } else {
                    if (engine.phase == SmsEnginePhase.Paused) {
                        Button(
                            onClick = { viewModel.resumeSending() },
                            modifier = Modifier.weight(1f).height(56.dp),
                            shape = RoundedCornerShape(16.dp)
                        ) {
                            Icon(Icons.Default.PlayArrow, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text("Resume", fontWeight = FontWeight.Bold)
                        }
                    } else {
                        OutlinedButton(
                            onClick = { viewModel.pauseSending() },
                            modifier = Modifier.weight(1f).height(56.dp),
                            shape = RoundedCornerShape(16.dp)
                        ) {
                            Icon(Icons.Default.Refresh, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text("Pause", fontWeight = FontWeight.Bold)
                        }
                    }
                    Button(
                        onClick = { viewModel.stopSending() },
                        modifier = Modifier.weight(1f).height(56.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                        shape = RoundedCornerShape(16.dp)
                    ) {
                        Icon(Icons.Default.Close, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Stop", fontWeight = FontWeight.Bold)
                    }
                }
            }

            Spacer(Modifier.height(8.dp))

            // Battery Settings hint
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextButton(
                    onClick = {
                        runCatching {
                            context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                        }
                    }
                ) {
                    Icon(Icons.Outlined.Settings, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Battery Optimization Settings")
                }
            }
            
            Spacer(Modifier.height(32.dp))
        }
    }

    if (showSettingsDialog) {
        AlertDialog(
            onDismissRequest = { showSettingsDialog = false },
            icon = { Icon(Icons.Default.Warning, contentDescription = null) },
            title = { Text("Permissions needed") },
            text = {
                Text(
                    "MSMS needs contacts access to build the recipient list, SMS permission to send messages, " +
                        "phone/SIM state to bind outgoing traffic to the correct subscription, and (on Android 13+) " +
                        "notifications permission to show the required foreground status notification while sending.",
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showSettingsDialog = false
                        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                            data = Uri.fromParts("package", context.packageName, null)
                        }
                        context.startActivity(intent)
                    },
                ) { Text("App settings") }
            },
            dismissButton = {
                TextButton(onClick = { showSettingsDialog = false }) { Text("Close") }
            },
        )
    }
}

@Composable
private fun PermissionEducationCard(onContinue: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Permissions Required", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onErrorContainer, fontWeight = FontWeight.Bold)
            Text(
                "MSMS needs access to your contacts to build the recipient list, and SMS/Phone permissions to send messages through your carrier.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            Button(
                onClick = onContinue,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.onErrorContainer,
                    contentColor = MaterialTheme.colorScheme.errorContainer
                ),
                modifier = Modifier.align(Alignment.End)
            ) {
                Text("Grant Permissions")
            }
        }
    }
}

@Composable
private fun PermissionSettingsCard(
    onOpenSettings: () -> Unit,
    onRetry: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                "Permissions Still Required",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
                fontWeight = FontWeight.Bold,
            )
            Text(
                "Some permissions were denied. Please open App Settings and grant all required permissions, then return to this screen.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.align(Alignment.End),
            ) {
                OutlinedButton(onClick = onRetry) {
                    Text("Try Again")
                }
                Button(
                    onClick = onOpenSettings,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.onSecondaryContainer,
                        contentColor = MaterialTheme.colorScheme.secondaryContainer,
                    ),
                ) {
                    Text("Open Settings")
                }
            }
        }
    }
}

@Composable
private fun StatusCard(
    title: String,
    value: String,
    subtitle: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    containerColor: Color,
    contentColor: Color,
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = containerColor, contentColor = contentColor),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(contentColor.copy(alpha = 0.1f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp), tint = contentColor)
                }
                Spacer(Modifier.width(12.dp))
                Text(title, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = contentColor.copy(alpha = 0.8f))
            }
            Spacer(Modifier.height(16.dp))
            Text(value, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = contentColor.copy(alpha = 0.7f))
        }
    }
}
