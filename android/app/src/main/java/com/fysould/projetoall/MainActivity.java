package com.fysould.projetoall;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static final Uri OFFICE_URL =
            Uri.parse("https://projeto-all-condoconnect.sunnyode3.chatgpt.site/");

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        findViewById(R.id.open_office).setOnClickListener(view -> openOffice());
    }

    private void openOffice() {
        TextView feedback = findViewById(R.id.office_error);
        Intent intent = new Intent(Intent.ACTION_VIEW, OFFICE_URL);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        try {
            startActivity(intent);
            feedback.setVisibility(View.GONE);
        } catch (ActivityNotFoundException exception) {
            feedback.setText(R.string.browser_unavailable);
            feedback.setVisibility(View.VISIBLE);
        }
    }
}
