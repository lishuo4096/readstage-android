# The WebView <-> app bridge is invoked only from JavaScript, so R8 sees the
# @JavascriptInterface methods as unused and would strip/rename them. Keep them.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep the bridge class itself (added to the WebView by name from JS as "Android").
-keep class com.phil.mdreader.MainActivity$Bridge { *; }
