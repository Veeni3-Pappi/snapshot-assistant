package com.msms.repository

import android.content.Context
import android.provider.ContactsContract
import com.msms.model.Contact
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlin.coroutines.coroutineContext

class ContactRepository(private val context: Context) {

    suspend fun getAllContacts(): List<Contact> = withContext(Dispatchers.IO) {
        val contactList = ArrayList<Contact>(2048)
        val seenNumbers = HashSet<String>(4096)

        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone._ID,
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
        )

        context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            projection,
            null,
            null,
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} COLLATE NOCASE ASC"
        )?.use { cursor ->
            val rowIdIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone._ID)
            val idIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.CONTACT_ID)
            val nameIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
            val numberIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)

            var row = 0
            while (cursor.moveToNext()) {
                if (row++ % 256 == 0) coroutineContext.ensureActive()

                val rowId = if (rowIdIdx >= 0) cursor.getString(rowIdIdx) else row.toString()
                val contactId = if (idIdx >= 0) cursor.getString(idIdx) else rowId
                val name = (if (nameIdx >= 0) cursor.getString(nameIdx) else null)?.trim().orEmpty()
                    .ifBlank { "Unknown" }
                val rawNumber = if (numberIdx >= 0) cursor.getString(numberIdx) else null ?: continue

                val normalized = normalizePhoneNumber(rawNumber)
                if (!isValidNumber(normalized)) continue
                if (!seenNumbers.add(normalized)) continue

                val stableId = "${contactId.orEmpty()}|${rowId}|$normalized"
                contactList.add(
                    Contact(
                        id = stableId,
                        name = name,
                        phoneNumber = normalized,
                    )
                )
            }
        }

        contactList.trimToSize()
        contactList
    }

    private fun normalizePhoneNumber(raw: String): String {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return ""

        val hasPlus = trimmed.startsWith("+")
        val digitsAndPlus = buildString(trimmed.length) {
            for (ch in trimmed) {
                when (ch) {
                    in '0'..'9' -> append(ch)
                    '+' -> if (isEmpty()) append(ch)
                    else { /* ignore embedded '+' */ }
                    // Common pause/wait dialstring tokens — strip for SMS destination
                    ',', ';', 'N', 'n' -> Unit
                    else -> Unit
                }
            }
        }

        if (digitsAndPlus.isEmpty()) return ""

        return if (hasPlus && digitsAndPlus.startsWith("+")) {
            "+" + digitsAndPlus.substring(1).filter { it.isDigit() }
        } else {
            digitsAndPlus.filter { it.isDigit() }
        }
    }

    private fun isValidNumber(number: String): Boolean {
        if (number.isBlank()) return false
        val digits = number.removePrefix("+").filter { it.isDigit() }
        if (digits.length < 7 || digits.length > 15) return false
        // Filter obvious service codes / short codes if desired; keep >=7 to avoid too aggressive filtering
        return true
    }
}
