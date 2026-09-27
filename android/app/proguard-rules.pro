# Keep kotlinx.serialization generated serializers
-keepclassmembers class com.toneai.app.** {
    *** Companion;
}
-keepclasseswithmembers class com.toneai.app.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.toneai.app.**$$serializer { *; }
