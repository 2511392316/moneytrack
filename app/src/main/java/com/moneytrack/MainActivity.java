package com.moneytrack;

import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import java.io.OutputStream;

public class MainActivity extends AppCompatActivity {

    private ValueCallback<Uri[]> uploadCallback;
    private static final int REQ_FILE = 1001;

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

        wv.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                uploadCallback = filePathCallback;
                Intent intent = fileChooserParams.createIntent();
                try {
                    MainActivity.this.startActivityForResult(intent, REQ_FILE);
                } catch (Exception e) {
                    uploadCallback = null;
                    Toast.makeText(MainActivity.this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        wv.addJavascriptInterface(new WebAppInterface(this), "Android");

        wv.loadUrl("file:///android_asset/index.html");
        setContentView(wv);
    }

	@Override
	protected void onActivityResult(int requestCode, int resultCode, Intent data) {
		super.onActivityResult(requestCode, resultCode, data);
		if (requestCode == REQ_FILE) {
			if (uploadCallback == null) return;
			Uri[] results = null;
			if (resultCode == RESULT_OK && data != null) {
				if (data.getClipData() != null) {
					int count = data.getClipData().getItemCount();
					results = new Uri[count];
					for (int i = 0; i < count; i++) {
						results[i] = data.getClipData().getItemAt(i).getUri();
					}
				} else if (data.getData() != null) {
					results = new Uri[]{data.getData()};
				}
			}
			uploadCallback.onReceiveValue(results);
			uploadCallback = null;
		}
	}

    public class WebAppInterface {
        MainActivity mContext;

        WebAppInterface(MainActivity c) {
            mContext = c;
        }

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

        @JavascriptInterface
        public void saveCsv(String csv) {
            try {
                ContentValues values = new ContentValues();
                String fileName = "记账明细-" + System.currentTimeMillis() + ".csv";
                values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                values.put(MediaStore.Downloads.MIME_TYPE, "text/csv");
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    values.put(MediaStore.Downloads.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS);
                }
                Uri uri = mContext.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                OutputStream os = mContext.getContentResolver().openOutputStream(uri);
                os.write(csv.getBytes("UTF-8"));
                os.close();
                Toast.makeText(mContext, "已保存到下载目录：" + fileName, Toast.LENGTH_LONG).show();
            } catch (Exception e) {
                Toast.makeText(mContext, "保存失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
    }
}