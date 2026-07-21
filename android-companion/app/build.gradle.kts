plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val firebaseConfigPresent = file("google-services.json").isFile
if (firebaseConfigPresent) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "com.allied.radar.bridge"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.allied.radar.bridge"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("boolean", "FIREBASE_ENABLED", firebaseConfigPresent.toString())
        manifestPlaceholders["firebaseEnabled"] = firebaseConfigPresent.toString()
        manifestPlaceholders["firebaseServiceClass"] = if (firebaseConfigPresent) {
            ".FirebaseHandoffService"
        } else {
            ".PushUnavailableService"
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    if (firebaseConfigPresent) {
        sourceSets["main"].java.srcDir("src/firebase/java")
    }
}

dependencies {
    if (firebaseConfigPresent) {
        implementation(platform("com.google.firebase:firebase-bom:34.16.0"))
        implementation("com.google.firebase:firebase-messaging")
    }
    testImplementation("junit:junit:4.13.2")
}
