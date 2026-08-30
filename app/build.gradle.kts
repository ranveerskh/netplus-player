plugins {
    id("com.android.application")
}

android {
    namespace = "ca.netplus.stbplay"
    compileSdk = 36

    val releaseKeystorePath = System.getenv("STB_PLAY_KEYSTORE_PATH")
    val releaseKeystorePassword = System.getenv("STB_PLAY_KEYSTORE_PASSWORD")
    val releaseKeyAlias = System.getenv("STB_PLAY_KEY_ALIAS")
    val releaseKeyPassword = System.getenv("STB_PLAY_KEY_PASSWORD")

    defaultConfig {
        applicationId = "ca.netplus.stbplay"
        minSdk = 23
        targetSdk = 35
        versionCode = 162
        versionName = "1.6.2"
    }

    flavorDimensions += "distribution"
    productFlavors {
        create("sideload") {
            dimension = "distribution"
            buildConfigField("String", "DISTRIBUTION_CHANNEL", "\"sideload\"")
        }
        create("play") {
            dimension = "distribution"
            buildConfigField("String", "DISTRIBUTION_CHANNEL", "\"play_store\"")
        }
    }

    signingConfigs {
        if (!releaseKeystorePath.isNullOrBlank()
            && !releaseKeystorePassword.isNullOrBlank()
            && !releaseKeyAlias.isNullOrBlank()
            && !releaseKeyPassword.isNullOrBlank()) {
            create("release") {
                storeFile = file(releaseKeystorePath)
                storePassword = releaseKeystorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core:1.13.1")
    implementation("androidx.media3:media3-exoplayer:1.11.0")
    implementation("androidx.media3:media3-exoplayer-hls:1.11.0")
    implementation("androidx.media3:media3-ui:1.11.0")
}
