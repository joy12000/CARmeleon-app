pluginManagement {
    repositories {
        maven("https://repo1.maven.org/maven2")
        google { content { includeGroupByRegex("com\\.android.*"); includeGroupByRegex("com\\.google.*"); includeGroupByRegex("androidx.*") } }
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositories {
        maven("https://repo1.maven.org/maven2")
        google { content { includeGroupByRegex("com\\.android.*"); includeGroupByRegex("com\\.google.*"); includeGroupByRegex("androidx.*") } }
        maven("https://nexus-playground.pleos.ai/repository/maven-releases/") {
            content { includeGroupByRegex("ai\\.pleos.*") }
        }
    }
}
rootProject.name = "CARmeleon"
include(":shared", ":desktopApp", ":androidApp")
project(":androidApp").projectDir = file("android/app")
