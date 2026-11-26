plugins {
    id("com.android.application")
}

android {
    namespace = "com.fysould.projetoall"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.fysould.projetoall"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "1.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
