package com.vaultriad.app;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.*;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.*;
import static org.junit.Assert.*;

import android.content.Context;
import android.view.WindowManager;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.*;
import org.junit.*;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AndroidFlowTest {

  private UiDevice device;

  private void waitFor(String text) {
    assertTrue(
      "Timed out waiting for " + text,
      device.wait(Until.hasObject(By.text(text)), 25000)
    );
  }

  private void waitForView(ActivityScenario<MainActivity> scenario, int id) {
    long deadline = android.os.SystemClock.uptimeMillis() + 25000;
    java.util.concurrent.atomic.AtomicBoolean found =
      new java.util.concurrent.atomic.AtomicBoolean();
    do {
      scenario.onActivity(activity ->
        found.set(activity.findViewById(id) != null)
      );
      if (found.get()) return;
      android.os.SystemClock.sleep(100);
    } while (android.os.SystemClock.uptimeMillis() < deadline);
    fail("Timed out waiting for a native view");
  }

  private void tap(String text) {
    onView(withText(text)).perform(scrollTo(), click());
  }

  @Test
  public void setupEntryPendingConfirmRevealAndBackgroundLock() throws Exception {
    Context context =
      InstrumentationRegistry.getInstrumentation().getTargetContext();
    assertTrue(
      "Never wipe a production app",
      context.getPackageName().endsWith(".debug")
    );
    for (String name : new String[] {
      "vault.vtriad",
      "vault.vtriad.previous",
      "vault.vtriad.new",
      "vault.vtriad.previous.new",
      "biometric.os",
    })
      context.deleteFile(name);
    device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    try (
      ActivityScenario<MainActivity> scenario = ActivityScenario.launch(
        MainActivity.class
      )
    ) {
      waitFor("Create a vault");
      tap("Create a vault");
      onView(withId(R.id.password)).perform(
        scrollTo(),
        replaceText("synthetic Android master password!"),
        closeSoftKeyboard()
      );
      onView(withId(R.id.confirm_password)).perform(
        scrollTo(),
        replaceText("synthetic Android master password!"),
        closeSoftKeyboard()
      );
      tap("Create vault");
      waitFor("Add entry");
      scenario.onActivity(a ->
        assertTrue(
          (a.getWindow().getAttributes().flags &
            WindowManager.LayoutParams.FLAG_SECURE) !=
            0
        )
      );
      tap("Add entry");
      onView(withId(R.id.entry_name)).perform(
        scrollTo(),
        replaceText("Android fixture"),
        closeSoftKeyboard()
      );
      tap("Save entry");
      waitForView(scenario, R.id.secret);
      String secret = "Zz9!qwe-rt9!qwe";
      onView(withId(R.id.secret)).perform(
        scrollTo(),
        replaceText(secret),
        closeSoftKeyboard()
      );
      onView(withId(R.id.confirm_secret)).perform(
        scrollTo(),
        replaceText(secret),
        closeSoftKeyboard()
      );
      tap("Save as Pending");
      waitFor("Pending confirmation");
      tap("It worked, make it Current");
      waitFor("Reveal / hide Current secret");
      tap("Reveal / hide Current secret");
      onView(withText(secret)).check(matches(isDisplayed()));
      tap("Copy Current secret");
      scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);
      scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
      waitFor("Unlock vault");
      scenario.onActivity(activity -> {
        android.content.ClipboardManager clipboard =
          (android.content.ClipboardManager) activity.getSystemService(
            Context.CLIPBOARD_SERVICE
          );
        assertNotNull(clipboard.getPrimaryClip());
        assertEquals(
          secret,
          clipboard
            .getPrimaryClip()
            .getItemAt(0)
            .coerceToText(activity)
            .toString()
        );
      });
      onView(withId(R.id.password)).perform(
        scrollTo(),
        replaceText("synthetic Android master password!"),
        closeSoftKeyboard()
      );
      tap("Unlock vault");
      waitFor("Add entry");
      scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);
      scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
      waitFor("Unlock vault");
      assertTrue(context.getFileStreamPath("vault.vtriad").exists());
    }
  }
}
