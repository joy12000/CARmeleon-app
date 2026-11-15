package ai.pleos.carmeleon

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import ai.pleos.carmeleon.core.*
import ai.pleos.carmeleon.agent.*
import android.provider.OpenableColumns
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import ai.pleos.carmeleon.pleos.*
import ai.pleos.carmeleon.ui.CarmeleonApp
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import androidx.compose.runtime.*

/** Native Compose entry point. Vehicle APIs are provided only by the Android Pleos adapters. */
class MainActivity : ComponentActivity() {
    private val scope=MainScope()
    private lateinit var controller: JourneyController
    private lateinit var voice: PleosVoiceGateway
    private lateinit var agent: AgentRuntime
    private lateinit var ux: AndroidDrivingRestrictions
    private val exportDiagnostics = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null && ::agent.isInitialized) scope.launch {
            runCatching { withContext(Dispatchers.IO) { contentResolver.openOutputStream(uri)?.use { out ->
                out.write(agent.diagnostics.export("PLEOS_RUNTIME_UNVERIFIED").toByteArray(Charsets.UTF_8))
            } ?: error("저장 위치를 열지 못했습니다.") } }.onFailure { agent.showError(it.message ?: "진단 기록을 저장하지 못했습니다.") }
        }
    }
    private val pickMaterial = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null && ::agent.isInitialized) scope.launch {
            runCatching {
                val material = withContext(Dispatchers.IO) {
                    val name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                        if (cursor.moveToFirst()) cursor.getString(0) else "자료"
                    } ?: "자료"
                    val bytes = contentResolver.openInputStream(uri)?.use { stream ->
                        val out = java.io.ByteArrayOutputStream()
                        val buffer = ByteArray(8192)
                        while (true) { val count = stream.read(buffer); if (count < 0) break; require(out.size() + count <= 20 * 1024 * 1024) { "자료는 20MB까지 추가할 수 있습니다." }; out.write(buffer, 0, count) }
                        out.toByteArray()
                    } ?: error("파일을 열지 못했습니다.")
                    Triple(name, bytes, contentResolver.getType(uri) ?: "application/octet-stream")
                }
                agent.uploadMaterial(material.first, material.second, material.third)
            }.onFailure { agent.showError(it.message ?: "자료를 열지 못했습니다.") }
        }
    }
    private val permissions=registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if(::controller.isInitialized) controller.connect()
    }

    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        val vehicle=PleosVehicleGateway(this)
        voice=PleosVoiceGateway(this,
            microphonePermissionGranted={ ContextCompat.checkSelfPermission(this,Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED },
            onAudioFocusChanged=vehicle::setAudioFocusAllowed)
        val repository=BuildConfig.BACKEND_URL.takeIf { it.isNotBlank() }?.let { BunJourneyRepository(HttpUrlConnectionTransport(),it) }
        val navigation = PleosNavigationGateway(this)
        controller=JourneyController(scope,navigation,PleosLocationGateway(this),voice,vehicle,repository)
        val client = runCatching { AgentHttpClient(BuildConfig.AGENT_URL, AndroidAgentTokenVault(this)) }.getOrNull()
        agent = AgentRuntime(scope, controller, navigation, voice, client, FileAgentLocalStore(java.io.File(filesDir,"agent-cache")))
        ux = AndroidDrivingRestrictions(this)
        scope.launch { ux.allowed.collect { agent.setEditingAllowed(it) } }
        ux.connect()
        val reducedMotion=runCatching { Settings.Global.getFloat(contentResolver,Settings.Global.ANIMATOR_DURATION_SCALE,1f)==0f }.getOrDefault(false)
        setContent {
            var canHandleBack by remember { mutableStateOf(false) }
            val backRequests=remember { MutableSharedFlow<Unit>(extraBufferCapacity=1) }
            BackHandler(enabled=canHandleBack) { backRequests.tryEmit(Unit) }
            val agentState by agent.state.collectAsState()
            CarmeleonApp(controller,backRequests=backRequests,onBackStateChanged={canHandleBack=it},initialReducedMotion=reducedMotion,
                agent=agentState,onAgentSubmit=agent::submit,onAgentChoice={ id, accepted -> agent.decide(id,accepted) },onAgentCancel={agent.interrupt()},
                onMicrophoneToggle=agent::toggleMicrophone,onMemorySave=agent::saveMemory,onMemoryUpdate=agent::updateMemory,onMemoryDelete=agent::deleteMemory,
                onMaterialAdd=agent::addMaterial,onMaterialDelete=agent::deleteMaterial,onMaterialPick={pickMaterial.launch(arrayOf("text/*","application/pdf","image/*"))},
                onRouteEdit=agent::editRoute,onAuthenticate=agent::authenticate,onLogout=agent::logout,
                onRefresh=agent::refreshAccount,onSelectPath=agent::selectPath,onStartPath=agent::startPath,onCreatePath=agent::createPath,onOpenNavigationSearch=agent::openNavigationSearch,onOpenRouteOptions=agent::openRouteOptions,onOpenNavigationForeground=agent::openNavigationForeground,onExportDiagnostics={exportDiagnostics.launch("carmeleon-diagnostics-${System.currentTimeMillis()}.json")},
                onOpenSdkDiagnostics=if (BuildConfig.DEBUG) ({ startActivity(android.content.Intent().setClassName(this, "$packageName.PleosDiagnosticsActivity")) }) else null)
        }
        controller.connect()
        val needed=listOf(Manifest.permission.RECORD_AUDIO,Manifest.permission.ACCESS_COARSE_LOCATION,Manifest.permission.ACCESS_FINE_LOCATION)
            .filter { ContextCompat.checkSelfPermission(this,it)!=PackageManager.PERMISSION_GRANTED }
        if(needed.isNotEmpty()) permissions.launch(needed.toTypedArray())
    }
    override fun onStart() { super.onStart(); if(::controller.isInitialized) controller.setForeground(true); if(::agent.isInitialized) agent.setForeground(true) }
    override fun onStop() { if(::agent.isInitialized) agent.setForeground(false); if(::controller.isInitialized) controller.setForeground(false); if(::voice.isInitialized) voice.stop(); super.onStop() }
    override fun onDestroy() { if(::ux.isInitialized) ux.close(); if(::agent.isInitialized) agent.close(); if(::controller.isInitialized) controller.release(); scope.cancel(); super.onDestroy() }
}
