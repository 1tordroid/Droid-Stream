package com.vega

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.hierynomus.msfscc.fileinformation.FileIdBothDirectoryInformation
import com.hierynomus.smbj.SMBClient
import com.hierynomus.smbj.auth.AuthenticationContext
import com.hierynomus.smbj.share.DiskShare

class SmbModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "SmbModule"

    @ReactMethod
    fun list(
        host: String,
        shareName: String,
        path: String,
        username: String,
        password: String,
        domain: String,
        promise: Promise,
    ) {
        try {
            SMBClient().use { client ->
                client.connect(host).use { connection ->
                    val session = connection.authenticate(
                        AuthenticationContext(username, password.toCharArray(), domain.ifBlank { null }),
                    )
                    (session.connectShare(shareName) as DiskShare).use { share ->
                        val rows = Arguments.createArray()
                        val folder = path.trim().trim('/')
                        for (item: FileIdBothDirectoryInformation in share.list(folder)) {
                            if (item.fileName == "." || item.fileName == "..") continue
                            val row = Arguments.createMap()
                            row.putString("name", item.fileName)
                            row.putBoolean("directory", item.fileAttributes and 0x10L != 0L)
                            row.putDouble("size", item.endOfFile.toDouble())
                            rows.pushMap(row)
                        }
                        promise.resolve(rows)
                    }
                }
            }
        } catch (error: Exception) {
            promise.reject("SMB_ERROR", error.message, error)
        }
    }
}

class SmbPackage : com.facebook.react.ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext) =
        listOf(SmbModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext) = emptyList<com.facebook.react.uimanager.ViewManager<*, *>>()
}
