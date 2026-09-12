package com.msms.util

import android.content.Context
import com.msms.model.Contact
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Hands large recipient lists to [com.msms.service.SmsService] without risking Binder transaction limits.
 */
object RecipientsFileStore {
    private const val FILE_NAME = "msms_recipients_payload.json"

    fun write(context: Context, contacts: List<Contact>): File {
        val file = File(context.cacheDir, FILE_NAME)
        val array = JSONArray()
        contacts.forEach { c ->
            array.put(
                JSONObject()
                    .put("id", c.id)
                    .put("name", c.name)
                    .put("phone", c.phoneNumber)
            )
        }
        file.writeText(array.toString())
        return file
    }

    fun read(file: File): List<Contact> {
        val text = file.readText()
        val array = JSONArray(text)
        val out = ArrayList<Contact>(array.length())
        for (i in 0 until array.length()) {
            val o = array.getJSONObject(i)
            out.add(
                Contact(
                    id = o.optString("id"),
                    name = o.optString("name", "Unknown"),
                    phoneNumber = o.optString("phone")
                )
            )
        }
        return out
    }
}
