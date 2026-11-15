plugins {
    id("com.android.application")
    kotlin("android")
    kotlin("plugin.compose")
}
android {
    namespace = "ai.pleos.carmeleon"
    compileSdk = 36
    useLibrary("android.car")
    defaultConfig {
        applicationId = "ai.pleos.carmeleon"
        minSdk = 29
        targetSdk = 34
        versionCode = 2
        versionName = "0.2.0"
        buildConfigField("String", "AGENT_URL", "\"${providers.gradleProperty("carmeleon.agentUrl").orElse("http://10.0.2.2:3001").get()}\"")
        buildConfigField("String", "BACKEND_URL", "\"${providers.gradleProperty("carmeleon.backendUrl").orElse("").get()}\"")
    }
    buildFeatures { compose = true; buildConfig = true }
    sourceSets.getByName("main").assets.setSrcDirs(emptyList<String>())
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildTypes {
        release {
            isMinifyEnabled = false
            // Local review APK. Replace with the team's private signing config before store publishing.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}
dependencies {
    debugImplementation("androidx.compose.foundation:foundation:1.9.4")
    debugImplementation("androidx.compose.material3:material3:1.4.0")
    debugImplementation("androidx.compose.material:material-icons-extended:1.7.6")
    implementation(project(":shared"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("ai.pleos.playground:NaviHelper:3.0.5")
    implementation("ai.pleos.playground:FusedLocation:1.1.3")
    implementation("ai.pleos.playground:SpeechToText:3.3.1")
    implementation("ai.pleos.playground:TextToSpeech:3.3.1")
    implementation("ai.pleos.playground:Vehicle:2.3.2")
}
