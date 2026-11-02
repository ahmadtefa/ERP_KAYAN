plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.kayan.kayan_key_generator"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.kayan.kayan_key_generator"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["appLabel"] = "KAYAN Key Generator"
    }

    buildTypes {
        debug {
            // Separate app identity/storage: never upgrade a production app.
            applicationIdSuffix = ".testonly"
            manifestPlaceholders["appLabel"] = "KAYAN Key Generator - TEST ONLY"
        }
        release {
            // No approved Android app-signing certificate is configured yet.
            // Never substitute the shared debug keystore for production.
            signingConfig = null
        }
    }
}

// Fail closed: there is no approved production certificate or release pipeline
// yet. Only the explicitly labelled debug variant can be built. This must not
// be lifted until a certificate allowlist and final-APK verification exist.
androidComponents {
    beforeVariants(selector().all()) { variant ->
        if (variant.buildType != "debug") variant.enable = false
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
