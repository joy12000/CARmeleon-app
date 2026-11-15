package ai.pleos.carmeleon.pleos

import android.car.Car
import android.car.drivingstate.CarUxRestrictions
import android.car.drivingstate.CarUxRestrictionsManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Public AAOS UX policy, independent of gear and speed.
 *
 * Long route/material/account editors are allowed only after the platform explicitly reports
 * that distraction optimization is not required. Missing service, denied access, disconnect,
 * and close remain unknown; consumers must use `allowed == true`, never `allowed != false`.
 *
 * The app does not use CarDrivingStateManager's privileged APIs or wait for Car service.
 */
class AndroidDrivingRestrictions(context: Context) : AutoCloseable {
    private val appContext = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val mutableAllowed = MutableStateFlow<Boolean?>(null)
    val allowed = mutableAllowed.asStateFlow()
    private val mutableActiveRestrictions = MutableStateFlow<Int?>(null)
    /** Platform bitmask for diagnostics; not an invented driving state. */
    val activeRestrictions = mutableActiveRestrictions.asStateFlow()
    @Volatile private var closed = false
    private var started = false
    private var car: Car? = null
    private var manager: CarUxRestrictionsManager? = null
    @Volatile private var generation = 0L

    /** Safe from either thread. Connection completes through the Car lifecycle callback. */
    fun connect() {
        if (closed) return
        if (Looper.myLooper() != Looper.getMainLooper()) { main.post { connect() }; return }
        if (started) return
        started = true
        unknown()
        try {
            car = Car.createCar(appContext, main, Car.CAR_WAIT_TIMEOUT_DO_NOT_WAIT) { connectedCar, ready ->
                if (closed) {
                    if (ready) runCatching { connectedCar.disconnect() }
                    return@createCar
                }
                clearManager()
                unknown()
                if (!ready) return@createCar
                try {
                    val restrictions = connectedCar.getCarManager(Car.CAR_UX_RESTRICTION_SERVICE) as? CarUxRestrictionsManager
                        ?: return@createCar
                    manager = restrictions
                    val connectedGeneration = generation
                    val listener = object : CarUxRestrictionsManager.OnUxRestrictionsChangedListener {
                        override fun onUxRestrictionsChanged(value: CarUxRestrictions) {
                            if (!closed && connectedGeneration == generation) publish(value)
                        }
                    }
                    // Register first, then read the initial snapshot; never default to unrestricted.
                    restrictions.registerListener(listener)
                    publish(restrictions.currentCarUxRestrictions)
                } catch (_: Exception) {
                    clearManager()
                    unknown()
                }
            }
            if (car == null) { started = false; unknown() }
        } catch (_: Exception) {
            clearManager()
            car?.let { runCatching { it.disconnect() } }
            car = null
            started = false
            unknown()
        }
    }

    private fun publish(restrictions: CarUxRestrictions?) {
        if (closed) return
        if (restrictions == null) { unknown(); return }
        mutableActiveRestrictions.value = restrictions.activeRestrictions
        mutableAllowed.value = !restrictions.isRequiresDistractionOptimization
    }

    private fun unknown() {
        mutableAllowed.value = null
        mutableActiveRestrictions.value = null
    }

    private fun clearManager() {
        generation++ // Already queued callbacks from a disconnected manager cannot unlock editing.
        manager?.let { runCatching { it.unregisterListener() } }
        manager = null
    }

    override fun close() {
        if (closed) return
        closed = true
        unknown()
        val dispose = {
            clearManager()
            car?.let { runCatching { it.disconnect() } }
            car = null
            started = false
        }
        if (Looper.myLooper() == Looper.getMainLooper()) dispose() else main.post { dispose() }
    }
}
