package dev.terra.vdtest;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.MotionEvent;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.File;
import java.io.FileWriter;
import java.net.URI;

/** Dedicated TERRA browser surface. Refuses to load or accept input on Display 0. */
public final class BrowserActivity extends Activity {
    private static final String TAG = "TERRAVD";
    private WebView web;
    private int probes;
    private boolean loaded;

    private int displayId() {
        return Build.VERSION.SDK_INT >= 30 && getDisplay() != null ? getDisplay().getDisplayId() : 0;
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        int display = displayId();
        Log.i(TAG, "CREATE display=" + display);
        if (display <= 0) {
            Log.e(TAG, "BLOCKED display=0; refusing to load TERRA");
            finish();
            return;
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        String url = getIntent().getDataString();
        if (!validUrl(url)) {
            Log.e(TAG, "BLOCKED invalid URL=" + url);
            finish();
            return;
        }
        web = new WebView(this);
        web.setBackgroundColor(0xff101f2e);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i(TAG, "CONSOLE " + m.messageLevel() + " " + m.message());
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String finishedUrl) {
                loaded = true;
                Log.i(TAG, "PAGE_FINISHED display=" + displayId() + " url=" + finishedUrl + " title=" + view.getTitle());
                view.postDelayed(webglProbe, 1200);
            }
        });
        setContentView(web);
        String testCookie = getIntent().getStringExtra("terraCookie");
        if (testCookie != null && testCookie.matches("terra_session=[a-f0-9]{32}\\.[a-f0-9]{64}")) {
            CookieManager cookies = CookieManager.getInstance();
            cookies.setAcceptCookie(true);
            cookies.setCookie(url, testCookie + "; HttpOnly; SameSite=Lax", accepted -> {
                cookies.flush();
                Log.i(TAG, "QA fixture cookie installed=" + accepted);
                web.loadUrl(url);
            });
        } else web.loadUrl(url);
    }

    private boolean validUrl(String value) {
        if (value == null) return false;
        try {
            URI uri = URI.create(value);
            return "http".equals(uri.getScheme()) && ("127.0.0.1".equals(uri.getHost()) || "localhost".equals(uri.getHost())) && uri.getPort() == 38173;
        } catch (RuntimeException e) { return false; }
    }

    private final Runnable webglProbe = new Runnable() {
        @Override public void run() {
            if (web == null || isFinishing() || displayId() <= 0 || probes++ >= 20) return;
            web.evaluateJavascript("(()=>{const c=[...document.querySelectorAll('canvas')];let g=null;if(c[0]){try{g=c[0].getContext('webgl2')||c[0].getContext('webgl')}catch(e){}}return {title:document.title,ready:document.readyState,canvases:c.length,width:c[0]?.width||0,height:c[0]?.height||0,webgl:!!g,href:location.href}})()", value -> {
                Log.i(TAG, "WEBGL display=" + displayId() + " probe=" + probes + " result=" + value);
                if (value != null && value.contains("\"webgl\":true")) append("webgl.csv", SystemClock.elapsedRealtimeNanos() + "," + displayId() + "," + value + "\n");
                if (probes < 20 && (value == null || !value.contains("\"webgl\":true"))) web.postDelayed(webglProbe, 1000);
            });
        }
    };

    @Override public boolean dispatchTouchEvent(MotionEvent event) {
        int display = displayId();
        if (display <= 0) {
            Log.e(TAG, "BLOCKED_TOUCH display=" + display);
            return true;
        }
        append("touches.csv", SystemClock.elapsedRealtimeNanos() + "," + display + "," + event.getActionMasked() + "," + event.getX() + "," + event.getY() + "\n");
        return super.dispatchTouchEvent(event);
    }

    private void append(String name, String line) {
        try (FileWriter writer = new FileWriter(new File(getFilesDir(), name), true)) { writer.write(line); }
        catch (Exception e) { Log.e(TAG, "Could not write " + name, e); }
    }

    @Override protected void onDestroy() {
        if (web != null) { web.stopLoading(); web.destroy(); web = null; }
        Log.i(TAG, "DESTROY display=" + displayId() + " loaded=" + loaded);
        super.onDestroy();
    }
}
