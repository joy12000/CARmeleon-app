import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("multiplatform")
    kotlin("plugin.serialization")
    kotlin("plugin.compose")
    id("org.jetbrains.compose")
    id("com.android.library")
}
kotlin {
    androidTarget { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }
    jvm("desktop") { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }
    sourceSets {
        commonMain.dependencies {
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)
            implementation(compose.materialIconsExtended)
            implementation(compose.ui)
            implementation(compose.components.resources)
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
        }
        val jvmSharedMain by creating { dependsOn(commonMain.get()) }
        androidMain { dependsOn(jvmSharedMain) }
        val desktopMain by getting { dependsOn(jvmSharedMain) }
        val desktopTest by getting {
            dependencies {
                implementation(compose.desktop.currentOs)
                implementation(compose.desktop.uiTestJUnit4)
                implementation("junit:junit:4.13.2")
            }
        }
    }
    jvmToolchain(17)
}
android {
    namespace = "ai.pleos.carmeleon.shared"
    compileSdk = 36
    defaultConfig { minSdk = 29 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
