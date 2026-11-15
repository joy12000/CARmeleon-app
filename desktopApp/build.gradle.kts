import java.io.File

plugins {
    kotlin("jvm")
    kotlin("plugin.compose")
    id("org.jetbrains.compose")
}
kotlin { jvmToolchain(17) }
dependencies {
    implementation(project(":shared"))
    implementation(compose.desktop.currentOs)
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-swing:1.9.0")
}
compose.desktop {
    application {
        mainClass = "ai.pleos.carmeleon.desktop.MainKt"
        jvmArgs += listOf("-Dfile.encoding=UTF-8")
        nativeDistributions {
            packageName = "CARmeleon"
            packageVersion = "0.2.0"
            modules("java.net.http", "java.logging", "jdk.unsupported")
        }
    }
}

tasks.register("exportRuntimeClasspath") {
    dependsOn("classes")
    doLast {
        val runtime = sourceSets.main.get().runtimeClasspath.files
        layout.buildDirectory.file("runtime-classpath.txt").get().asFile.writeText(runtime.joinToString(File.pathSeparator))
    }
}
