import java.util.Properties
import java.net.URI
import java.util.Base64

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val signingProperties = Properties().apply {
    val propertiesFile = rootProject.file("key.properties")
    if (propertiesFile.exists()) propertiesFile.inputStream().use { load(it) }
}
fun signingValue(property: String, environment: String): String? =
    providers.environmentVariable(environment).orNull
        ?: signingProperties.getProperty(property)

val releaseStorePath = signingValue("storeFile", "ANDROID_KEYSTORE_PATH")
val releaseStorePassword = signingValue("storePassword", "ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = signingValue("keyAlias", "ANDROID_KEY_ALIAS")
val releaseKeyPassword = signingValue("keyPassword", "ANDROID_KEY_PASSWORD")

// Validate the resolved graph so abbreviated Gradle tasks cannot bypass the gate.
gradle.taskGraph.whenReady {
    if (allTasks.any { it.path.startsWith(":app:") &&
            it.name.matches(Regex("(assemble|bundle|package).*Release")) }) {
        require(listOf(releaseStorePath, releaseStorePassword, releaseKeyAlias,
            releaseKeyPassword).all { !it.isNullOrBlank() }) {
            "Release signing is required. Configure android/key.properties or ANDROID_KEYSTORE_* / ANDROID_KEY_* environment variables. See docs/release-readiness.md."
        }
        require(rootProject.file(releaseStorePath!!).isFile) {
            "Release keystore does not exist. Check storeFile or ANDROID_KEYSTORE_PATH."
        }
        val apiUrl = providers.gradleProperty("dart-defines").orNull.orEmpty()
            .split(',').filter { it.isNotBlank() }
            .map { String(Base64.getDecoder().decode(it), Charsets.UTF_8) }
            .lastOrNull { it.startsWith("PLANNER_API_URL=") }
            ?.substringAfter('=')
        val uri = apiUrl?.let { runCatching { URI(it) }.getOrNull() }
        require(uri?.scheme == "https" && !uri.host.isNullOrBlank() &&
            uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null &&
            uri.path.isNullOrEmpty()) {
            "Android release requires --dart-define=PLANNER_API_URL=https://your-api-host (HTTPS origin only)."
        }
    }
}

android {
    namespace = "com.alperen.planner"
    // flutter_secure_storage 37 istiyor; Flutter'ın varsayılanı (36) yetmiyor.
    compileSdk = 37
    ndkVersion = flutter.ndkVersion

    compileOptions {
        // flutter_local_notifications zamanlama için java.time gerektiriyor
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.alperen.planner"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            storeFile = releaseStorePath?.takeIf { it.isNotBlank() }?.let { rootProject.file(it) }
            storePassword = releaseStorePassword
            keyAlias = releaseKeyAlias
            keyPassword = releaseKeyPassword
        }
    }
    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}


dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
}
