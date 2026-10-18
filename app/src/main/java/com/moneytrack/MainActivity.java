package com.moneytrack;

import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import java.io.OutputStream;

public class MainActivity extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView wv = new WebView(this);
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        wv.setWebViewClient(new WebViewClient());
        wv.setWebChromeClient(new WebChromeClient());
        wv.addJavascriptInterface(new WebAppInterface(this), "Android");

        wv.loadUrl("file:///android_asset/index.html");
        setContentView(wv);
    }

    public class WebAppInterface {
        MainActivity mContext;
        WebAppInterface(MainActivity c) { mContext = c; }

        @JavascriptInterface
        public void saveJson(String json) {
            try {
                ContentValues values = new ContentValues();
                String fileName = "记账备份-" + System.currentTimeMillis() + ".json";
                values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    values.put(MediaStore.Downloads.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS);
                }
                Uri uri = mContext.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                OutputStream os = mContext.getContentResolver().openOutputStream(uri);
                os.write(json.getBytes("UTF-8"));
                os.close();
                Toast.makeText(mContext, "已保存到下载目录：" + fileName, Toast.LENGTH_LONG).show();
            } catch (Exception e) {
                Toast.makeText(mContext, "保存失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
    }
}
