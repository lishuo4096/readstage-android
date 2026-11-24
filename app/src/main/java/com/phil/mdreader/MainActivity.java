package com.phil.mdreader;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

public class MainActivity extends Activity {

    private static final int REQ_OPEN = 42;
    private static final int REQ_TREE = 43;
    private static final String PREFS = "mdreader";
    private static final String KEY_LAST = "last_uri";
    private static final String KEY_RECENTS = "recents";      // JSON array of {uri,name,ts}
    private static final String KEY_SCROLL = "scroll";        // JSON object uri -> y
    private static final String KEY_SETTINGS = "settings";    // JSON object of options
    private static final String KEY_FOLDER = "folder";        // JSON object {uri,name} of a browsed folder
    private static final int MAX_RECENTS = 30;
    private static final int MAX_FOLDER_FILES = 500;

    private WebView web;
    private boolean pageReady = false;
    private String pendingJs = null;   // JS to run once the page has loaded

    // Currently-open document.
    private Uri currentUri = null;
    private String currentText = null;
    private String currentName = null;

    // UI state mirrored from the JS layer, used to route the hardware Back button.
    private volatile boolean jsInReader = false;
    private volatile boolean jsOverlayOpen = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        int startupBg = startupBgColor();
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(startupBg);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        s.setAllowFileAccess(true);
        s.setBuiltInZoomControls(true);   // pinch-to-zoom for reading
        s.setDisplayZoomControls(false);
        s.setDomStorageEnabled(true);
        web.setBackgroundColor(startupBg);
        web.addJavascriptInterface(new Bridge(), "Android");
        ReaderBridge readerBridge = new ReaderBridge(this, web);
        web.addJavascriptInterface(readerBridge, "NativeReader");
        web.addJavascriptInterface(new FileBridge(), "NativeFiles");
        if (android.os.Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 90);
        root.setOnApplyWindowInsetsListener((v, insets) -> { android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.ime()); v.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets; });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                if (pendingJs != null) {
                    web.evaluateJavascript(pendingJs, null);
                    pendingJs = null;
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                // Let our own asset page (and in-page #fragments) load normally.
                if (u != null && u.toString().startsWith("file:///android_asset/")) return false;
                // Open web/mail/tel links externally; block anything else from
                // replacing the viewer and stranding the app.
                openExternally(u);
                return true;
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        setContentView(root);
        web.loadUrl("file:///android_asset/viewer.html");

        // Decide the startup view: an "open with" intent, else the last file (if enabled), else home.
        Uri incoming = null;
        Intent intent = getIntent();
        if (intent != null && Intent.ACTION_VIEW.equals(intent.getAction())) {
            incoming = intent.getData();
        }
        if (incoming != null) {
            tryPersist(incoming);
            queueLoad(incoming, true);
        } else if (reopenLastEnabled()) {
            String last = prefs().getString(KEY_LAST, null);
            if (last != null) queueLoad(Uri.parse(last), false);
            else pendingJs = "App.showHome();";
        } else {
            pendingJs = "App.showHome();";
        }
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private boolean reopenLastEnabled() {
        try {
            JSONObject o = new JSONObject(prefs().getString(KEY_SETTINGS, "{}"));
            return o.optBoolean("reopenLast", true);
        } catch (Exception e) {
            return true;
        }
    }

    private boolean isNightMode() {
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    /** Pick a launch background matching the saved theme, so there's no color flash. */
    private int startupBgColor() {
        String theme = "dark";
        try {
            theme = new JSONObject(prefs().getString(KEY_SETTINGS, "{}")).optString("theme", "dark");
        } catch (Exception ignored) {}
        if (theme == null || theme.isEmpty()) theme = "dark";
        if ("auto".equals(theme)) theme = isNightMode() ? "dark" : "light";
        switch (theme) {
            case "light": return Color.parseColor("#ffffff");
            case "sepia": return Color.parseColor("#f4ecd8");
            case "black": return Color.parseColor("#000000");
            default:      return Color.parseColor("#0d1117"); // dark
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        boolean dark = (newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        runJs("App.systemThemeChanged(" + dark + ");");
    }

    // ---- File picking -------------------------------------------------------

    private void pickFile() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                "text/markdown", "text/x-markdown", "text/plain", "application/octet-stream"});
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            startActivityForResult(i, REQ_OPEN);
        } catch (Exception e) {
            toast("No file picker available");
        }
    }

    private void pickFolder() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            startActivityForResult(i, REQ_TREE);
        } catch (Exception e) {
            toast("No folder picker available");
        }
    }

    /** Best-effort persist of a read grant so a file survives in Recents. */
    private void tryPersist(Uri uri) {
        try {
            getContentResolver().takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ignored) {
            try {getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);}catch(Exception ignoredRead){}
        }
    }

    private void openExternally(Uri uri) {
        if (uri == null) return;
        String scheme = uri.getScheme();
        if (scheme == null) return;
        scheme = scheme.toLowerCase();
        if (scheme.equals("http") || scheme.equals("https")
                || scheme.equals("mailto") || scheme.equals("tel")) {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, uri);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Exception e) {
                toast("No app to open that link");
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_OPEN && resultCode == RESULT_OK && data != null) {
            Uri uri = data.getData();
            if (uri != null) {
                tryPersist(uri);
                if (!loadFrom(uri, true)) toast("Could not read that file");
            }
        } else if (requestCode == REQ_TREE && resultCode == RESULT_OK && data != null) {
            Uri tree = data.getData();
            if (tree != null) {
                try {
                    getContentResolver().takePersistableUriPermission(tree,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                } catch (Exception ignored) {}
                try {
                    JSONObject f = new JSONObject();
                    f.put("uri", tree.toString());
                    f.put("name", treeDisplayName(tree));
                    prefs().edit().putString(KEY_FOLDER, f.toString()).apply();
                } catch (Exception ignored) {}
                runJs("App.refreshHome();");
            }
        }
    }

    // ---- Loading & rendering ------------------------------------------------

    /** Load before the page is ready (startup): defer the render call. */
    private void queueLoad(Uri uri, boolean addRecent) {
        String text = readText(uri);
        if (text == null) { pendingJs = "App.showHome();"; return; }
        String name = displayName(uri);
        currentUri = uri; currentText = text; currentName = name;
        prefs().edit().putString(KEY_LAST, uri.toString()).apply();
        if (addRecent) addRecent(uri, name);
        pendingJs = renderJs(text, uri.toString(), name);
    }

    private boolean loadFrom(Uri uri, boolean addRecent) {
        String text = readText(uri);
        if (text == null) return false;
        String name = displayName(uri);
        currentUri = uri; currentText = text; currentName = name;
        prefs().edit().putString(KEY_LAST, uri.toString()).apply();
        if (addRecent) addRecent(uri, name);
        runJs(renderJs(text, uri.toString(), name));
        return true;
    }

    private String renderJs(String text, String uri, String name) {
        return "App.render(" + JSONObject.quote(text) + ","
                + JSONObject.quote(uri) + "," + JSONObject.quote(name) + ");";
    }

    private void runJs(final String js) {
        if (pageReady) web.evaluateJavascript(js, null);
        else pendingJs = js;
    }

    private String readText(Uri uri) {
        StringBuilder sb = new StringBuilder();
        try (InputStream is = getContentResolver().openInputStream(uri);
             BufferedReader r = new BufferedReader(
                     new InputStreamReader(is, StandardCharsets.UTF_8))) {
            char[] buf = new char[8192];
            int n;
            while ((n = r.read(buf)) != -1) sb.append(buf, 0, n);
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    private String displayName(Uri uri) {
        String name = null;
        try (Cursor c = getContentResolver().query(
                uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) name = c.getString(i);
            }
        } catch (Exception ignored) {}
        if (name == null) {
            name = uri.getLastPathSegment();
            if (name != null && name.contains("/")) name = name.substring(name.lastIndexOf('/') + 1);
        }
        return name != null ? name : "Untitled.md";
    }

    // ---- Recent files (MRU) -------------------------------------------------

    private void addRecent(Uri uri, String name) {
        try {
            JSONArray old = recentsArray();
            String u = uri.toString();
            JSONArray out = new JSONArray();
            JSONObject first = new JSONObject();
            first.put("uri", u);
            first.put("name", name);
            first.put("ts", System.currentTimeMillis());
            out.put(first);
            for (int i = 0; i < old.length() && out.length() < MAX_RECENTS; i++) {
                JSONObject o = old.getJSONObject(i);
                if (!u.equals(o.optString("uri"))) out.put(o);
            }
            prefs().edit().putString(KEY_RECENTS, out.toString()).apply();
        } catch (Exception ignored) {}
    }

    private JSONArray recentsArray() {
        try {
            return new JSONArray(prefs().getString(KEY_RECENTS, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private void removeRecentUri(String uri) {
        try {
            JSONArray old = recentsArray();
            JSONArray out = new JSONArray();
            for (int i = 0; i < old.length(); i++) {
                JSONObject o = old.getJSONObject(i);
                if (!uri.equals(o.optString("uri"))) out.put(o);
            }
            prefs().edit().putString(KEY_RECENTS, out.toString()).apply();
            // Drop any persisted URI permission we no longer need.
            try {
                getContentResolver().releasePersistableUriPermission(
                        Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignored) {}
        } catch (Exception ignored) {}
    }

    // ---- Folder browsing (SAF document tree) --------------------------------

    private String treeDisplayName(Uri tree) {
        try {
            String docId = DocumentsContract.getTreeDocumentId(tree);
            int colon = docId.indexOf(':');
            String path = colon >= 0 ? docId.substring(colon + 1) : docId;
            if (path.isEmpty()) return "Folder";
            int slash = path.lastIndexOf('/');
            return slash >= 0 ? path.substring(slash + 1) : path;
        } catch (Exception e) {
            return "Folder";
        }
    }

    private static boolean isMarkdownName(String name) {
        if (name == null) return false;
        String n = name.toLowerCase();
        return n.endsWith(".md") || n.endsWith(".markdown") || n.endsWith(".txt");
    }

    /** Recursively walk a document tree collecting markdown-ish files (name-sorted, capped). */
    private JSONArray listFolderFiles(Uri treeUri) {
        List<JSONObject> found = new ArrayList<>();
        try {
            ArrayDeque<String> stack = new ArrayDeque<>();
            stack.push(DocumentsContract.getTreeDocumentId(treeUri));
            int guard = 0;
            while (!stack.isEmpty() && found.size() < MAX_FOLDER_FILES && guard < 5000) {
                guard++;
                String parentId = stack.pop();
                Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId);
                try (Cursor c = getContentResolver().query(children, new String[]{
                        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                        DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
                    if (c == null) continue;
                    while (c.moveToNext() && found.size() < MAX_FOLDER_FILES) {
                        String id = c.getString(0);
                        String name = c.getString(1);
                        String mime = c.getString(2);
                        if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                            stack.push(id);
                        } else if (isMarkdownName(name)) {
                            Uri docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, id);
                            JSONObject o = new JSONObject();
                            o.put("uri", docUri.toString());
                            o.put("name", name);
                            String rootId=DocumentsContract.getTreeDocumentId(treeUri);
                            o.put("path",id.startsWith(rootId+"/")?id.substring(rootId.length()+1):name);
                            String chapter=name;
                            if(!name.matches(".*第[零〇一二两三四五六七八九十百千万0-9]+[章节回卷].*")){
                                try(InputStream in=getContentResolver().openInputStream(docUri);InputStreamReader reader=new InputStreamReader(in,StandardCharsets.UTF_8)){
                                    char[] prefix=new char[2048];int count=reader.read(prefix);
                                    if(count>0){java.util.regex.Matcher m=java.util.regex.Pattern.compile("第[零〇一二两三四五六七八九十百千万0-9]+[章节回卷][^\\r\\n]{0,50}").matcher(new String(prefix,0,count));if(m.find())chapter=m.group();}
                                }catch(Exception ignored){}
                            }
                            o.put("chapter",chapter);
                            found.add(o);
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        Collections.sort(found, new Comparator<JSONObject>() {
            @Override public int compare(JSONObject a, JSONObject b) {
                return a.optString("name").compareToIgnoreCase(b.optString("name"));
            }
        });
        JSONArray out = new JSONArray();
        for (JSONObject o : found) out.put(o);
        return out;
    }

    // ---- Scroll memory ------------------------------------------------------

    private void putScroll(String uri, int y) {
        try {
            JSONObject o = new JSONObject(prefs().getString(KEY_SCROLL, "{}"));
            o.put(uri, y);
            prefs().edit().putString(KEY_SCROLL, o.toString()).apply();
        } catch (Exception ignored) {}
    }

    private int getScroll(String uri) {
        try {
            return new JSONObject(prefs().getString(KEY_SCROLL, "{}")).optInt(uri, 0);
        } catch (Exception e) {
            return 0;
        }
    }

    // ---- Sharing ------------------------------------------------------------

    private void shareCurrent() {
        if (currentText == null) { toast("Nothing to share"); return; }
        try {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/markdown");
            i.putExtra(Intent.EXTRA_TEXT, currentText);
            if (currentName != null) i.putExtra(Intent.EXTRA_SUBJECT, currentName);
            startActivity(Intent.createChooser(i, "Share Markdown"));
        } catch (Exception e) {
            toast("Could not share");
        }
    }

    // ---- Back-button routing ------------------------------------------------

    @Override
    public void onBackPressed() {
        if (jsOverlayOpen) { web.evaluateJavascript("App.closeOverlays();", null); return; }
        if (jsInReader)   { web.evaluateJavascript("App.goHome();", null); return; }
        if(PlaybackProxy.running){moveTaskToBack(true);return;}
        super.onBackPressed();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && Intent.ACTION_VIEW.equals(intent.getAction())
                && intent.getData() != null) {
            tryPersist(intent.getData());
            if (!loadFrom(intent.getData(), true)) toast("Could not read that file");
        }
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
    }

    // ---- JavaScript bridge --------------------------------------------------
    // NOTE: these run on a binder thread. Anything that touches the WebView or
    // starts an Activity is marshalled onto the UI thread.

    public final class FileBridge {
        @JavascriptInterface public void chooseWorkspace(String uri,String name){runOnUiThread(()->{
            try{boolean granted=false;for(android.content.UriPermission permission:getContentResolver().getPersistedUriPermissions())if(permission.getUri().toString().equals(uri)&&permission.isReadPermission())granted=true;
                if(!granted)throw new Exception();JSONObject folder=new JSONObject();folder.put("uri",uri);folder.put("name",name);prefs().edit().putString(KEY_FOLDER,folder.toString()).apply();runJs("App.workspaceSelected();");
            }catch(Exception e){toast("工作区授权已失效，请重新选择文件夹");}
        });}
        private Uri relative(String path) throws Exception {
            if(currentUri==null || path.contains(":") || path.startsWith("/"))throw new Exception();
            path=Uri.decode(path.split("[?#]",2)[0]);
            if("file".equals(currentUri.getScheme())) {
                java.io.File file=new java.io.File(new java.io.File(currentUri.getPath()).getParentFile(),path).getCanonicalFile();
                if(!file.getPath().startsWith(getFilesDir().getCanonicalPath()+java.io.File.separator))throw new Exception();
                return Uri.fromFile(file);
            }
            Uri tree=Uri.parse(new JSONObject(prefs().getString(KEY_FOLDER,"{}")).getString("uri"));
            String id=DocumentsContract.getDocumentId(currentUri),root=DocumentsContract.getTreeDocumentId(tree);
            String parent=id.substring(0,id.lastIndexOf('/')+1);
            java.util.ArrayDeque<String> parts=new java.util.ArrayDeque<>();
            for(String part:(parent+path).split("/")){if(part.equals("..")){if(parts.isEmpty())throw new Exception();parts.removeLast();}else if(!part.equals(".")&&!part.isEmpty())parts.add(part);}
            String resolved=String.join("/",parts);
            if(!resolved.startsWith(root+"/"))throw new Exception();
            return DocumentsContract.buildDocumentUriUsingTree(tree,resolved);
        }
        @JavascriptInterface public String image(String path) {
            try {Uri uri=relative(path);String ext=path.toLowerCase();String mime=ext.endsWith(".png")?"image/png":ext.endsWith(".webp")?"image/webp":ext.endsWith(".gif")?"image/gif":ext.endsWith(".jpg")||ext.endsWith(".jpeg")?"image/jpeg":null;
                if(mime==null)return "";
                try(InputStream in=getContentResolver().openInputStream(uri);java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream()){
                    byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){out.write(b,0,n);if(out.size()>5*1024*1024)return "";}
                    return "data:"+mime+";base64,"+android.util.Base64.encodeToString(out.toByteArray(),2);
                }
            }catch(Exception e){return "";}
        }
        @JavascriptInterface public void openRelative(String path){runOnUiThread(()->{try{loadFrom(relative(path),true);}catch(Exception e){toast("无法打开相对文档，请从工作区选择");}});}
        @JavascriptInterface public String save(String uri,String text) {
            if(currentUri==null || !currentUri.toString().equals(uri))return "文件已切换，请重新保存";
            try(java.io.OutputStream out=getContentResolver().openOutputStream(currentUri,"wt")) {
                out.write(text.getBytes(StandardCharsets.UTF_8)); currentText=text;return "";
            }catch(Exception e){return "保存失败：请授予文件或工作区写入权限。草稿仍保留在本机。";}
        }
        @JavascriptInterface public void create(String name){runOnUiThread(()->{
            try {
                JSONObject folder=new JSONObject(prefs().getString(KEY_FOLDER,"{}"));
                Uri tree=Uri.parse(folder.getString("uri"));
                Uri parent=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
                String safe=name.replaceAll("[\\\\/:*?\\\"<>|]","_");
                if(!safe.toLowerCase().endsWith(".md"))safe+=".md";
                Uri created=DocumentsContract.createDocument(getContentResolver(),parent,"text/markdown",safe);
                if(created!=null)loadFrom(created,true);
            }catch(Exception e){toast("请先打开可写工作区，再新建文件");}
        });}
        @JavascriptInterface public void demo(){runOnUiThread(()->{
            try {
                java.io.File f=new java.io.File(getFilesDir(),"墨声使用指南.md");
                if(!f.exists())try(InputStream in=getAssets().open("demo.md");java.io.OutputStream out=new java.io.FileOutputStream(f)){in.transferTo(out);}
                loadFrom(Uri.fromFile(f),true);
            }catch(Exception e){toast("无法打开示例");}
        });}
    }

    private final class Bridge {

        @JavascriptInterface
        public String getRecents() {
            return recentsArray().toString();
        }

        @JavascriptInterface
        public String getSettings() {
            return prefs().getString(KEY_SETTINGS, "{}");
        }

        @JavascriptInterface
        public boolean isSystemDark() {
            return isNightMode();
        }

        @JavascriptInterface
        public void setSetting(final String key, final String value) {
            try {
                JSONObject o = new JSONObject(prefs().getString(KEY_SETTINGS, "{}"));
                // Store booleans/numbers as their natural JSON type where possible.
                if ("true".equals(value) || "false".equals(value)) {
                    o.put(key, Boolean.parseBoolean(value));
                } else {
                    try { o.put(key, Integer.parseInt(value)); }
                    catch (NumberFormatException nfe) { o.put(key, value); }
                }
                prefs().edit().putString(KEY_SETTINGS, o.toString()).apply();
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void openRecent(final String uri) {
            runOnUiThread(() -> {
                try {
                    if (!loadFrom(Uri.parse(uri), true)) {
                        // The file is gone or the grant expired — drop the dead entry.
                        removeRecentUri(uri);
                        toast("File unavailable — removed from list");
                        web.evaluateJavascript("App.refreshHome();", null);
                    }
                } catch (Exception e) {
                    toast("Could not open that file");
                }
            });
        }

        @JavascriptInterface
        public void removeRecent(final String uri) {
            removeRecentUri(uri);
        }

        @JavascriptInterface
        public void clearRecents() {
            prefs().edit().remove(KEY_RECENTS).apply();
        }

        @JavascriptInterface
        public void pickFile() {
            runOnUiThread(MainActivity.this::pickFile);
        }

        @JavascriptInterface
        public void pickFolder() {
            runOnUiThread(MainActivity.this::pickFolder);
        }

        @JavascriptInterface
        public String getFolder() {
            return prefs().getString(KEY_FOLDER, "");
        }

        @JavascriptInterface
        public void clearFolder() {
            String f = prefs().getString(KEY_FOLDER, "");
            prefs().edit().remove(KEY_FOLDER).apply();
            try {
                Uri tree = Uri.parse(new JSONObject(f).optString("uri"));
                getContentResolver().releasePersistableUriPermission(tree,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignored) {}
        }

        /** Walk the saved folder off the UI thread, then push the result into the page. */
        @JavascriptInterface
        public void requestFolderList() {
            final String f = prefs().getString(KEY_FOLDER, "");
            new Thread(() -> {
                String json = "[]";
                if (!f.isEmpty()) {
                    try {
                        Uri tree = Uri.parse(new JSONObject(f).optString("uri"));
                        json = listFolderFiles(tree).toString();
                    } catch (Exception ignored) {}
                }
                final String result = json;
                runOnUiThread(() -> web.evaluateJavascript(
                        "App.setFolderList(" + JSONObject.quote(result) + ");", null));
            }).start();
        }

        @JavascriptInterface
        public void copy(final String text) {
            runOnUiThread(() -> {
                try {
                    ClipboardManager cm =
                            (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    cm.setPrimaryClip(ClipData.newPlainText("code", text));
                    toast("Copied");
                } catch (Exception e) {
                    toast("Copy failed");
                }
            });
        }

        @JavascriptInterface
        public void reloadCurrent() {
            runOnUiThread(() -> {
                if (currentUri != null) {
                    if (!loadFrom(currentUri, false)) toast("Could not reload");
                } else {
                    toast("No file open");
                }
            });
        }

        @JavascriptInterface
        public void shareCurrent() {
            runOnUiThread(MainActivity.this::shareCurrent);
        }

        @JavascriptInterface
        public void saveScroll(String uri, int y) {
            if (uri != null) putScroll(uri, y);
        }

        @JavascriptInterface
        public int getScroll(String uri) {
            return uri != null ? MainActivity.this.getScroll(uri) : 0;
        }

        @JavascriptInterface
        public void setState(boolean inReader, boolean overlayOpen) {
            jsInReader = inReader;
            jsOverlayOpen = overlayOpen;
        }

        @JavascriptInterface
        public void toast(final String msg) {
            runOnUiThread(() -> MainActivity.this.toast(msg));
        }
    }
}
