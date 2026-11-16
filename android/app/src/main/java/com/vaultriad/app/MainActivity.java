package com.vaultriad.app;

import android.app.*;
import android.content.*;
import android.content.ClipboardManager;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.hardware.biometrics.*;
import android.net.Uri;
import android.os.*;
import android.security.keystore.*;
import android.text.*;
import android.text.method.PasswordTransformationMethod;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import org.json.*;

/** Native UI only: no WebView, no network permission, no exported secret APIs. */
public final class MainActivity extends Activity {

  private final Handler main = new Handler(Looper.getMainLooper());
  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private VaultFiles files;
  private JSONObject vault;
  private byte[] key;
  private VaultCrypto.Envelope header;
  private LinearLayout root;
  private ScrollView scroll;
  private boolean busy = false,
    active = false,
    initialized = false;
  private int epoch = 0,
    failures = 0;
  private long retryAt = 0;
  private String restoreRaw = null;
  private byte[] copiedFingerprint;
  private long clipboardExpires;
  private final Map<View, Boolean> enabledStates = new IdentityHashMap<>();
  private CancellationSignal biometricSignal;
  private Runnable clipboardClear;
  private static final int EXPORT = 20,
    RESET = 21,
    RESTORE = 22,
    PREVIOUS = 23;
  private static final int BG = 0xff101312,
    FG = 0xffe5eae6,
    MUTED = 0xffaab8ae,
    ACCENT = 0xffa6cfac,
    PANEL = 0xff1d2420;
  private static final String[] CATEGORIES = {
    "Hardware",
    "Online Domains",
    "API Keys & Tools",
  };
  private static final String[] CATEGORY_IDS = { "hardware", "domains", "api" };

  private static final class Session {

    JSONObject vault;
    byte[] key;
    VaultCrypto.Envelope header;

    Session(JSONObject v, byte[] k, VaultCrypto.Envelope h) {
      vault = v;
      key = k;
      header = h;
    }
  }

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    getWindow().setDecorFitsSystemWindows(false);
    if (Build.VERSION.SDK_INT >= 31) getWindow().setHideOverlayWindows(true);
    files = new VaultFiles(this);
    screen("Vaultriad");
    text("Opening your private vault…", 16, MUTED);
    task(
      () -> files.exists() ? VaultCrypto.inspect(files.read()) : null,
      h -> {
        header = h;
        initialized = true;
        gate();
      }
    );
  }

  @Override
  protected void onStart() {
    super.onStart();
    active = true;
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (vault == null && !busy) {
      if (restoreRaw != null) {
        gate();
        return;
      }
      screen("Vaultriad");
      note("Loading locked vault settings…");
      task(
        () -> files.exists() ? VaultCrypto.inspect(files.read()) : null,
        h -> {
          header = h;
          initialized = true;
          gate();
        }
      );
    }
  }

  @Override
  protected void onStop() {
    lock(false);
    active = false;
    super.onStop();
  }

  @Override
  protected void onDestroy() {
    epoch++;
    io.shutdownNow();
    main.removeCallbacksAndMessages(null);
    super.onDestroy();
  }

  @Override
  public void onUserInteraction() {
    super.onUserInteraction();
    scheduleLock();
  }

  private final Runnable inactivity = () -> lock(true);

  private void scheduleLock() {
    main.removeCallbacks(inactivity);
    if (vault != null) main.postDelayed(
      inactivity,
      Math.max(
        1,
        Math.min(
          120,
          vault.optJSONObject("preferences").optInt("autoLockMinutes", 5)
        )
      ) * 60000L
    );
  }

  private void lock(boolean show) {
    epoch++;
    enabledStates.clear();
    busy = false;
    if (key != null) Arrays.fill(key, (byte) 0);
    key = null;
    vault = null;
    restoreRaw = null;
    if (biometricSignal != null) {
      biometricSignal.cancel();
      biometricSignal = null;
    }
    main.removeCallbacks(inactivity);
    if (show) clearClipboard();
    if (root != null) root.removeAllViews();
    if (show && initialized) gate();
  }

  private int dp(int v) {
    return Math.round(v * getResources().getDisplayMetrics().density);
  }

  private void screen(String title) {
    scroll = new ScrollView(this);
    scroll.setFillViewport(true);
    scroll.setBackgroundColor(BG);
    scroll.setSaveEnabled(false);
    root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(dp(22), dp(22), dp(22), dp(30));
    root.setImportantForAutofill(
      View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
    );
    root.setSaveEnabled(false);
    root.setSaveFromParentEnabled(false);
    scroll.addView(root);
    scroll.setOnApplyWindowInsetsListener((v, insets) -> {
      android.graphics.Insets bars = insets.getInsets(
        WindowInsets.Type.systemBars() |
          WindowInsets.Type.displayCutout() |
          WindowInsets.Type.ime()
      );
      root.setPadding(
        dp(22) + bars.left,
        dp(22) + bars.top,
        dp(22) + bars.right,
        dp(30) + bars.bottom
      );
      return WindowInsets.CONSUMED;
    });
    setContentView(scroll);
    TextView heading = text(title, 27, FG);
    heading.setTypeface(null, Typeface.BOLD);
    heading.setPadding(0, 0, 0, dp(12));
  }

  private TextView text(String value, int size, int color) {
    TextView view = new TextView(this);
    view.setText(value);
    view.setTextSize(size);
    view.setTextColor(color);
    view.setSaveEnabled(false);
    view.setPadding(0, dp(5), 0, dp(5));
    root.addView(view);
    return view;
  }

  private TextView note(String value) {
    return text(value, 14, MUTED);
  }

  private Button button(String label, Runnable action) {
    Button view = new Button(this);
    view.setText(label);
    view.setAllCaps(false);
    view.setTextSize(15);
    view.setMinHeight(dp(48));
    view.setTextColor(BG);
    view.setBackgroundTintList(ColorStateList.valueOf(ACCENT));
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
    lp.setMargins(0, dp(7), 0, dp(3));
    root.addView(view, lp);
    view.setOnClickListener(v -> {
      if (!busy) try {
        action.run();
      } catch (Exception e) {
        error(e);
      }
    });
    return view;
  }

  private EditText field(String label, String value, boolean secret, int id) {
    text(label, 14, MUTED);
    EditText edit = new EditText(this);
    edit.setTextColor(FG);
    edit.setHintTextColor(MUTED);
    edit.setTextSize(16);
    edit.setText(value);
    edit.setSaveEnabled(false);
    edit.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
    edit.setInputType(
      android.text.InputType.TYPE_CLASS_TEXT |
        android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
    );
    edit.setSingleLine(false);
    if (secret) edit.setTransformationMethod(
      PasswordTransformationMethod.getInstance()
    );
    if (id != 0) edit.setId(id);
    root.addView(edit, new LinearLayout.LayoutParams(-1, -2));
    return edit;
  }

  private CheckBox check(String label, boolean checked) {
    CheckBox box = new CheckBox(this);
    box.setText(label);
    box.setTextColor(FG);
    box.setTextSize(14);
    box.setChecked(checked);
    box.setButtonTintList(ColorStateList.valueOf(ACCENT));
    box.setMinHeight(dp(48));
    box.setSaveEnabled(false);
    root.addView(box);
    return box;
  }

  private Spinner select(String label, String[] options, int selected) {
    text(label, 14, MUTED);
    Spinner spinner = new Spinner(this);
    ArrayAdapter<String> adapter = new ArrayAdapter<>(
      this,
      android.R.layout.simple_spinner_dropdown_item,
      options
    );
    spinner.setAdapter(adapter);
    spinner.setSelection(Math.max(0, selected));
    spinner.setMinimumHeight(dp(48));
    spinner.setSaveEnabled(false);
    root.addView(spinner, new LinearLayout.LayoutParams(-1, -2));
    return spinner;
  }

  private void enabled(View v, boolean enabled) {
    if (!enabled) enabledStates.put(v, v.isEnabled());
    v.setEnabled(enabled ? enabledStates.getOrDefault(v, true) : false);
    if (v instanceof android.view.ViewGroup) {
      android.view.ViewGroup g = (android.view.ViewGroup) v;
      for (int i = 0; i < g.getChildCount(); i++) enabled(
        g.getChildAt(i),
        enabled
      );
    }
  }

  private <T> void task(Callable<T> work, Consumer<T> success) {
    int generation = epoch;
    busy = true;
    enabled(root, false);
    io.execute(() -> {
      try {
        T result = work.call();
        main.post(() -> {
          if (generation != epoch || isFinishing()) {
            if (result instanceof Session) Arrays.fill(
              ((Session) result).key,
              (byte) 0
            );
            return;
          }
          busy = false;
          enabled(root, true);
          enabledStates.clear();
          success.accept(result);
        });
      } catch (Throwable e) {
        main.post(() -> {
          if (generation != epoch || isFinishing()) return;
          busy = false;
          enabled(root, true);
          enabledStates.clear();
          initialized = true;
          error(e);
          if (vault == null && root.getChildCount() < 3) gate();
        });
      }
    });
  }

  private void error(Throwable e) {
    String message =
      e instanceof VaultCrypto.VaultException
        ? e.getMessage()
        : "Operation failed. Preserve your encrypted backups and try again.";
    if (active && !isFinishing()) new AlertDialog.Builder(this)
      .setTitle("Vaultriad")
      .setMessage(message)
      .setPositiveButton("OK", null)
      .show();
  }

  private void toast(String message) {
    if (active) Toast.makeText(this, message, Toast.LENGTH_LONG).show();
  }

  private void confirm(String title, String message, Runnable action) {
    new AlertDialog.Builder(this)
      .setTitle(title)
      .setMessage(message)
      .setNegativeButton("Cancel", null)
      .setPositiveButton("Confirm", (d, w) -> action.run())
      .show();
  }

  private interface Action {
    void apply(JSONObject v) throws Exception;
  }

  private void mutate(Action action, Runnable after) {
    if (vault == null || key == null) {
      gate();
      return;
    }
    try {
      JSONObject next = new JSONObject(vault.toString());
      action.apply(next);
      byte[] working = key.clone();
      VaultCrypto.Factors factors = header.factors;
      String salt = header.salt;
      task(
        () -> {
          try {
            String raw = VaultCrypto.seal(next, working, factors, salt);
            files.write(raw);
            return VaultCrypto.inspect(raw);
          } finally {
            Arrays.fill(working, (byte) 0);
          }
        },
        h -> {
          vault = next;
          header = h;
          scheduleLock();
          after.run();
        }
      );
    } catch (Exception e) {
      error(e);
    }
  }

  private void accept(Session s) {
    if (key != null) Arrays.fill(key, (byte) 0);
    key = s.key;
    vault = s.vault;
    header = s.header;
    restoreRaw = null;
    failures = 0;
    retryAt = 0;
    scheduleLock();
    home();
  }

  private Session unlock(
    String raw,
    VaultCrypto.Credentials c,
    boolean restore
  ) throws Exception {
    VaultCrypto.Envelope e = VaultCrypto.inspect(raw);
    byte[] candidate = VaultCrypto.derive(c, e.factors, e.salt);
    try {
      JSONObject v = VaultCrypto.open(raw, candidate);
      if (restore) {
        raw = VaultCrypto.seal(v, candidate, e.factors, e.salt);
        files.write(raw);
        e = VaultCrypto.inspect(raw);
      }
      Session result = new Session(v, candidate, e);
      candidate = null;
      return result;
    } finally {
      if (candidate != null) Arrays.fill(candidate, (byte) 0);
    }
  }

  private void gate() {
    if (!initialized) return;
    boolean restoring = restoreRaw != null;
    screen("Vaultriad");
    if (!files.exists() && !restoring) {
      note("Your secrets. Your control. A local-first Android vault.");
      button("Create a vault", () -> credentialsSetup(false));
      button("Restore encrypted backup", () -> pickRestore());
      note(
        "Android 11+ · No network permission · MIT open source\nKeep off-device encrypted backups. Uninstalling deletes this phone’s vault and biometric keys."
      );
      button("About & license", this::about);
      return;
    }
    if (header == null) {
      note(
        "The encrypted vault could not be read. Preserve its files and backups. No data has been overwritten."
      );
      button("Export rolling encrypted backup", () -> export(PREVIOUS));
      button("Reset and start over", this::reset);
      return;
    }
    text(restoring ? "Restore your vault" : "Welcome back", 23, FG);
    note(
      "Every credential group enabled for this vault is required. Questions are never a recovery bypass."
    );
    CredentialForm form = new CredentialForm(header.factors, false);
    Button unlockButton = button(
      restoring ? "Restore vault" : "Unlock vault",
      () -> {
        if (SystemClock.elapsedRealtime() < retryAt) {
          toast("Please wait before trying again.");
          return;
        }
        VaultCrypto.Credentials credentials = form.value();
        String selected = restoreRaw;
        form.clear();
        task(() -> {
          try {
            return unlock(
              selected != null ? selected : files.read(),
              credentials,
              selected != null
            );
          } catch (Exception e) {
            failures++;
            retryAt =
              SystemClock.elapsedRealtime() +
              Math.min(30000, 1000L << Math.min(5, failures - 1));
            throw new VaultCrypto.VaultException(
              "Unable to unlock. Check your credentials and use an intact backup. No individual factor is identified."
            );
          }
        }, this::accept);
      }
    );
    unlockButton.setId(R.id.create_vault);
    if (SystemClock.elapsedRealtime() < retryAt) note(
      "Increasing retry delay is active (up to 30 seconds)."
    );
    if (!restoring) {
      if (files.biometricFile().exists()) button("Unlock with biometrics", () ->
        quickUnlock()
      );
      note(
        "Can’t get in? Reset and start over. Your current vault must first be saved as an encrypted backup requiring its original credentials."
      );
      button("Reset and start over", this::reset);
      button("Export rolling encrypted backup", () -> export(PREVIOUS));
    } else button("Cancel restore", () -> {
      restoreRaw = null;
      header = null;
      gate();
    });
  }

  private final class CredentialForm {

    final CheckBox passwordOn, pinOn, questionsOn;
    final EditText password, pin, confirm;
    final Spinner[] questions = new Spinner[3];
    final EditText[] answers = new EditText[3];
    final VaultCrypto.Factors existing;

    CredentialForm(VaultCrypto.Factors factors, boolean setup) {
      existing = factors;
      passwordOn = setup ? check("Master password · Recommended", true) : null;
      if (setup || factors.password) {
        password = field("Master password", "", true, R.id.password);
        password.setSingleLine(true);
      } else password = null;
      confirm = setup
        ? field("Confirm master password", "", true, R.id.confirm_password)
        : null;
      pinOn = setup ? check("Numeric PIN · Recommended", false) : null;
      if (setup || factors.pin) {
        pin = field("PIN (6–12 digits)", "", true, R.id.pin);
        pin.setInputType(
          android.text.InputType.TYPE_CLASS_NUMBER |
            android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
        );
        pin.setSingleLine(true);
      } else pin = null;
      questionsOn = setup
        ? check("Three security questions · Recommended", false)
        : null;
      for (int i = 0; i < 3; i++) {
        if (setup) {
          questions[i] = select(
            "Security question " + (i + 1),
            VaultCrypto.QUESTIONS,
            i
          );
          answers[i] = field("Answer " + (i + 1), "", true, 0);
        } else if (factors.questions.length == 3) answers[i] = field(
          factors.questions[i],
          "",
          true,
          0
        );
      }
      if (setup) {
        note(
          "At least one group is required. All enabled groups are required to unlock. A 12+ character master password is recommended. Questions/PIN alone are easier to guess. Enabling fewer than all three groups is less protected."
        );
        passwordOn.setOnCheckedChangeListener((b, on) -> updateVisibility());
        pinOn.setOnCheckedChangeListener((b, on) -> updateVisibility());
        questionsOn.setOnCheckedChangeListener((b, on) -> updateVisibility());
        updateVisibility();
      }
      CheckBox show = check("Show credential fields", false);
      show.setOnCheckedChangeListener((b, on) -> {
        for (EditText e : all())
          if (e != null) e.setTransformationMethod(
            on ? null : PasswordTransformationMethod.getInstance()
          );
      });
    }

    List<EditText> all() {
      List<EditText> list = new ArrayList<>(
        Arrays.asList(password, pin, confirm)
      );
      list.addAll(Arrays.asList(answers));
      return list;
    }

    void updateVisibility() {
      password.setEnabled(passwordOn.isChecked());
      confirm.setEnabled(passwordOn.isChecked());
      pin.setEnabled(pinOn.isChecked());
      for (int i = 0; i < 3; i++) {
        int visibility = questionsOn.isChecked() ? View.VISIBLE : View.GONE;
        questions[i].setVisibility(visibility);
        root
          .getChildAt(root.indexOfChild(questions[i]) - 1)
          .setVisibility(visibility);
        answers[i].setVisibility(visibility);
        root
          .getChildAt(root.indexOfChild(answers[i]) - 1)
          .setVisibility(visibility);
      }
    }

    VaultCrypto.Factors factors() {
      if (passwordOn == null) return existing;
      String[] qs = questionsOn.isChecked()
        ? new String[] {
            questions[0].getSelectedItem().toString(),
            questions[1].getSelectedItem().toString(),
            questions[2].getSelectedItem().toString(),
          }
        : new String[0];
      return new VaultCrypto.Factors(
        passwordOn.isChecked(),
        pinOn.isChecked(),
        qs
      );
    }

    VaultCrypto.Credentials value() {
      String[] a = new String[existing != null
        ? existing.questions.length
        : questionsOn.isChecked()
          ? 3
          : 0];
      for (int i = 0; i < a.length; i++) a[i] = answers[i].getText().toString();
      return new VaultCrypto.Credentials(
        password == null ? "" : password.getText().toString(),
        pin == null ? "" : pin.getText().toString(),
        a
      );
    }

    void clear() {
      for (EditText e : all()) if (e != null) e.setText("");
    }
  }

  private void credentialsSetup(boolean change) {
    screen(change ? "New unlock credentials" : "Make it yours");
    CredentialForm form = new CredentialForm(null, true);
    button(change ? "Re-encrypt vault" : "Create vault", () -> {
      try {
        VaultCrypto.Factors factors = form.factors();
        VaultCrypto.Credentials c = form.value();
        VaultCrypto.validateSetup(factors, c);
        if (
          factors.password &&
          !c.password.equals(form.confirm.getText().toString())
        ) throw new VaultCrypto.VaultException(
          "The master passwords do not match."
        );
        JSONObject content = change
          ? new JSONObject(vault.toString())
          : VaultModel.empty();
        form.clear();
        task(() -> {
          String salt = VaultCrypto.salt();
          byte[] derived = VaultCrypto.derive(c, factors, salt);
          try {
            String raw = VaultCrypto.seal(content, derived, factors, salt);
            files.write(raw);
            deleteBiometrics();
            Session result = new Session(
              content,
              derived,
              VaultCrypto.inspect(raw)
            );
            derived = null;
            return result;
          } finally {
            if (derived != null) Arrays.fill(derived, (byte) 0);
          }
        }, this::accept);
      } catch (Exception e) {
        error(e);
      }
    }).setId(R.id.create_vault);
    button("Cancel", () -> {
      if (change) settings();
      else gate();
    });
  }

  private void verifyCredentials(Consumer<VaultCrypto.Credentials> next) {
    screen("Verify your credentials");
    CredentialForm form = new CredentialForm(header.factors, false);
    button("Verify credentials", () -> {
      VaultCrypto.Credentials c = form.value();
      form.clear();
      task(() -> {
        byte[] candidate = null;
        try {
          candidate = VaultCrypto.derive(c, header.factors, header.salt);
          VaultCrypto.open(files.read(), candidate);
          return c;
        } catch (Exception e) {
          throw new VaultCrypto.VaultException(
            "Unable to verify original credentials."
          );
        } finally {
          if (candidate != null) Arrays.fill(candidate, (byte) 0);
        }
      }, next);
    });
    button("Cancel", this::settings);
  }

  private void home() {
    if (vault == null) {
      gate();
      return;
    }
    screen("Vaultriad");
    note("Personal vault · encrypted on this device");
    button("Lock vault", () -> lock(true));
    button("Add entry", () -> editEntry(null));
    button("Settings & backups", this::settings);
    EditText search = field("Search your vault", "", false, R.id.search);
    String[] filters = {
      "All entries",
      CATEGORIES[0],
      CATEGORIES[1],
      CATEGORIES[2],
    };
    Spinner categories = select("Category", filters, 0);
    LinearLayout list = new LinearLayout(this);
    list.setOrientation(LinearLayout.VERTICAL);
    root.addView(list);
    Runnable draw = () -> {
      list.removeAllViews();
      try {
        String query = search.getText().toString().toLowerCase(Locale.ROOT);
        JSONArray entries = vault.getJSONArray("entries");
        int count = 0;
        for (int i = 0; i < entries.length(); i++) {
          JSONObject e = entries.getJSONObject(i);
          String id = e.getString("id");
          int selected = categories.getSelectedItemPosition();
          if (
            selected > 0 &&
            !e.optString("category").equals(CATEGORY_IDS[selected - 1])
          ) continue;
          String haystack = (
            e.optString("name") +
            " " +
            e.optString("username") +
            " " +
            e.optString("location") +
            " " +
            e.optString("notes") +
            " " +
            e.optJSONArray("tags")
          ).toLowerCase(Locale.ROOT);
          if (!haystack.contains(query)) continue;
          Button row = new Button(this);
          row.setAllCaps(false);
          row.setMinHeight(dp(60));
          row.setTextColor(FG);
          row.setBackgroundTintList(ColorStateList.valueOf(PANEL));
          row.setText(
            e.getString("name") +
              "\n" +
              e.optString("username") +
              (!e.isNull("pending") ? " · PENDING" : "")
          );
          row.setOnClickListener(v -> detail(id, "current"));
          list.addView(row, new LinearLayout.LayoutParams(-1, -2));
          count++;
        }
        if (count == 0) {
          TextView empty = new TextView(this);
          empty.setText(
            "No entries yet. Add your first entry or restore an encrypted desktop backup."
          );
          empty.setTextColor(MUTED);
          empty.setPadding(0, dp(22), 0, dp(22));
          list.addView(empty);
        }
      } catch (Exception e) {
        error(e);
      }
    };
    search.addTextChangedListener(
      new TextWatcher() {
        public void beforeTextChanged(
          CharSequence s,
          int start,
          int count,
          int after
        ) {}

        public void onTextChanged(
          CharSequence s,
          int start,
          int before,
          int count
        ) {
          draw.run();
        }

        public void afterTextChanged(Editable e) {}
      }
    );
    categories.setOnItemSelectedListener(
      new AdapterView.OnItemSelectedListener() {
        public void onItemSelected(
          AdapterView<?> p,
          View v,
          int position,
          long id
        ) {
          draw.run();
        }

        public void onNothingSelected(AdapterView<?> p) {}
      }
    );
    draw.run();
    note(
      "Keep encrypted backups off this phone. Uninstalling removes this vault and biometric keys."
    );
  }

  private void editEntry(String id) {
    try {
      JSONObject old = id == null ? null : VaultModel.find(vault, id);
      screen(old == null ? "Add entry" : "Edit entry");
      EditText name = field(
          "Name",
          old == null ? "" : old.optString("name"),
          false,
          R.id.entry_name
        ),
        username = field(
          "Username / identifier",
          old == null ? "" : old.optString("username"),
          false,
          0
        ),
        location = field(
          "URL / device details",
          old == null ? "" : old.optString("location"),
          false,
          0
        ),
        notes = field(
          "Notes",
          old == null ? "" : old.optString("notes"),
          false,
          0
        ),
        tags = field(
          "Tags, separated by commas",
          old == null ? "" : joinTags(old.optJSONArray("tags")),
          false,
          0
        );
      int cat = 0;
      if (old != null) for (int i = 0; i < 3; i++) if (
        CATEGORY_IDS[i].equals(old.optString("category"))
      ) cat = i;
      Spinner category = select("Category", CATEGORIES, cat);
      EditText rotation = field(
        "Rotation reminder, days (0 = none)",
        old == null ? "90" : String.valueOf(old.optInt("rotationDays", 0)),
        false,
        0
      );
      rotation.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
      button("Save entry", () -> {
        String selectedCategory = CATEGORY_IDS[
          category.getSelectedItemPosition()
        ];
        String n = name.getText().toString(),
          u = username.getText().toString(),
          l = location.getText().toString(),
          no = notes.getText().toString(),
          t = tags.getText().toString();
        int days;
        try {
          days = Integer.parseInt(rotation.getText().toString());
          if (days < 0 || days > 3650) throw new NumberFormatException();
        } catch (NumberFormatException ex) {
          error(new VaultCrypto.VaultException("Choose 0–3650 days."));
          return;
        }
        final int reminder = days;
        final String[] result = { id };
        mutate(
          v -> {
            if (id == null) {
              JSONObject entry = VaultModel.create(
                n,
                u,
                l,
                no,
                t,
                selectedCategory
              );
              entry.put(
                "rotationDays",
                reminder == 0 ? JSONObject.NULL : reminder
              );
              result[0] = entry.getString("id");
              v.getJSONArray("entries").put(entry);
            } else {
              if (
                n.trim().isEmpty() || n.length() > 200
              ) throw new VaultCrypto.VaultException(
                "Enter a name with at most 200 characters."
              );
              JSONObject entry = VaultModel.find(v, id);
              JSONArray arr = new JSONArray();
              for (String tag : t.split(","))
                if (!tag.trim().isEmpty()) arr.put(tag.trim());
              entry
                .put("name", n.trim())
                .put("username", u)
                .put("location", l)
                .put("notes", no)
                .put("tags", arr)
                .put("category", selectedCategory)
                .put("rotationDays", reminder == 0 ? JSONObject.NULL : reminder)
                .put("updatedAt", VaultModel.now());
            }
          },
          () -> detail(result[0], id == null ? "new" : "current")
        );
      });
      button("Cancel", () -> {
        if (id == null) home();
        else detail(id, "current");
      });
    } catch (Exception e) {
      error(e);
    }
  }

  private String joinTags(JSONArray tags) {
    if (tags == null) return "";
    List<String> s = new ArrayList<>();
    for (int i = 0; i < tags.length(); i++) s.add(tags.optString(i));
    return String.join(", ", s);
  }

  private void secret(String label, String value) {
    text(label, 14, MUTED);
    TextView shown = text("•••• •••• •••• ••••", 20, FG);
    shown.setTypeface(Typeface.MONOSPACE);
    boolean[] visible = { false };
    button("Reveal / hide " + label, () -> {
      visible[0] = !visible[0];
      shown.setText(visible[0] ? value : "•••• •••• •••• ••••");
    });
    button("Copy " + label, () -> copy(value));
  }

  private void detail(String id, String section) {
    if (vault == null) {
      gate();
      return;
    }
    try {
      JSONObject entry = VaultModel.find(vault, id);
      screen(entry.getString("name"));
      note(entry.optString("username") + "\n" + entry.optString("location"));
      button("Back to vault", this::home);
      button("Lock vault", () -> lock(true));
      if (!entry.isNull("pending")) {
        JSONObject pending = entry.getJSONObject("pending");
        text("Pending confirmation", 20, ACCENT);
        note(
          "Current is unchanged. Test the new secret on its service, then confirm the result."
        );
        try {
          if (
            Instant.now().toEpochMilli() -
              Instant.parse(pending.getString("createdAt")).toEpochMilli() >
            86400000
          ) note(
            "Reminder: this secret has been Pending for more than 24 hours."
          );
        } catch (Exception ignored) {}
        secret("Pending secret", pending.getString("value"));
        button("It worked, make it Current", () ->
          mutate(
            v -> VaultModel.resolve(VaultModel.find(v, id), true),
            () -> detail(id, "current")
          )
        );
        button("It didn’t work, discard", () ->
          confirm(
            "Discard Pending?",
            "Current and Past will remain unchanged.",
            () ->
              mutate(
                v -> VaultModel.resolve(VaultModel.find(v, id), false),
                () -> detail(id, "current")
              )
          )
        );
      }
      for (String part : new String[] { "current", "past", "new" }) {
        String title = part.equals("current")
          ? "Current"
          : part.equals("past")
            ? "Past · " + entry.getJSONArray("past").length()
            : "New";
        Button headerButton = button(title, () -> detail(id, part));
        headerButton.setStateDescription(
          part.equals(section) ? "Expanded" : "Collapsed"
        );
        if (!part.equals(section)) continue;
        if (part.equals("current")) {
          if (entry.optString("current").isEmpty()) note(
            "No Current secret. Create one in New and confirm it works."
          );
          else {
            secret("Current secret", entry.getString("current"));
            note("Last confirmed: " + entry.optString("rotatedAt"));
          }
        } else if (part.equals("past")) {
          JSONArray history = entry.getJSONArray("past");
          if (history.length() == 0) note(
            "Previous secrets appear after confirmed replacements."
          );
          for (int index = 0; index < history.length(); index++) {
            final String pastId = history.getJSONObject(index).getString("id");
            JSONObject p = history.getJSONObject(index);
            note("Replaced: " + p.optString("replacedAt"));
            secret("Past secret " + (index + 1), p.getString("value"));
            button("Delete past secret " + (index + 1), () ->
              confirm(
                "Delete this past secret?",
                "This cannot be undone in the current vault. Encrypted backups may retain copies.",
                () ->
                  mutate(
                    v -> {
                      JSONArray arr = VaultModel.find(v, id).getJSONArray(
                        "past"
                      );
                      for (int j = 0; j < arr.length(); j++) if (
                        pastId.equals(arr.getJSONObject(j).getString("id"))
                      ) {
                        arr.remove(j);
                        break;
                      }
                    },
                    () -> detail(id, "past")
                  )
              )
            );
          }
        } else {
          if (!entry.isNull("pending")) note(
            "Resolve Pending before creating another secret."
          );
          else newSecret(id, entry);
        }
      }
      if (!entry.optString("notes").isEmpty()) {
        text("Notes", 16, MUTED);
        text(entry.getString("notes"), 16, FG);
      }
      note("Tags: " + joinTags(entry.optJSONArray("tags")));
      note(
        "Added: " +
          entry.optString("createdAt") +
          "\nUpdated: " +
          entry.optString("updatedAt")
      );
      button("Edit entry", () -> editEntry(id));
      button("Delete entry", () ->
        confirm(
          "Delete entry and its history?",
          "This cannot be undone in the current vault. Encrypted backups may retain copies.",
          () ->
            mutate(v -> {
              JSONArray arr = v.getJSONArray("entries");
              for (int i = 0; i < arr.length(); i++) if (
                id.equals(arr.getJSONObject(i).getString("id"))
              ) {
                arr.remove(i);
                break;
              }
            }, this::home)
        )
      );
    } catch (Exception e) {
      error(e);
    }
  }

  private void newSecret(String id, JSONObject entry) throws Exception {
    JSONObject rules = new JSONObject(entry.getJSONObject("rules").toString());
    EditText value = field("New secret", "", true, R.id.secret),
      confirmation = field(
        "Type the new secret again",
        "",
        true,
        R.id.confirm_secret
      );
    CheckBox reveal = check("Show both secret fields", false);
    reveal.setOnCheckedChangeListener((v, on) -> {
      value.setTransformationMethod(
        on ? null : PasswordTransformationMethod.getInstance()
      );
      confirmation.setTransformationMethod(
        on ? null : PasswordTransformationMethod.getInstance()
      );
    });
    note(
      "Generation uses the entry’s stored rules, including restrictions imported from desktop."
    );
    EditText length = field(
      "Generated password length (8–128)",
      String.valueOf(rules.optInt("length", 20)),
      false,
      0
    );
    length.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
    CheckBox upper = check("Uppercase", rules.optBoolean("upper")),
      lower = check("Lowercase", rules.optBoolean("lower")),
      numbers = check("Numbers", rules.optBoolean("numbers")),
      symbols = check("Symbols", rules.optBoolean("symbols"));
    EditText allowedSymbols = field(
        "Allowed generator symbols",
        rules.optString("allowedSymbols"),
        false,
        0
      ),
      max = field(
        "Service maximum length",
        String.valueOf(rules.optInt("max", 128)),
        false,
        0
      );
    max.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
    CheckBox ambiguous = check(
      "Exclude look-alike characters in generation",
      rules.optBoolean("ambiguous")
    );
    note(
      "Advanced restrictions and passphrase profiles from desktop are preserved. Choosing a mobile password generator switches this entry to password mode when you save."
    );
    Runnable updateRules = () -> {
      try {
        int n = Integer.parseInt(length.getText().toString()),
          m = Integer.parseInt(max.getText().toString());
        if (
          n < 8 || n > 128 || m < 1 || m > 128
        ) throw new NumberFormatException();
        rules
          .put("length", n)
          .put("max", m)
          .put("upper", upper.isChecked())
          .put("lower", lower.isChecked())
          .put("numbers", numbers.isChecked())
          .put("symbols", symbols.isChecked())
          .put("allowedSymbols", allowedSymbols.getText().toString())
          .put("ambiguous", ambiguous.isChecked());
      } catch (Exception ex) {
        throw new IllegalArgumentException("Choose lengths within 8–128.");
      }
    };
    button("Generate password", () -> {
      try {
        updateRules.run();
        rules.put("mode", "password");
        task(
          () -> PasswordRules.generate(rules),
          generated -> {
            value.setText(generated);
            confirmation.setText(generated);
            toast(
              "Generated. Save as Pending, then test it before confirmation."
            );
          }
        );
      } catch (Exception e) {
        error(
          new VaultCrypto.VaultException(
            "Check the generator lengths and rules."
          )
        );
      }
    });
    button("Save as Pending", () -> {
      try {
        updateRules.run();
        String next = value.getText().toString(),
          again = confirmation.getText().toString();
        if (!next.equals(again) || next.isEmpty()) {
          error(
            new VaultCrypto.VaultException(
              "Enter the same nonempty secret twice."
            )
          );
          return;
        }
        List<String> warnings = PasswordRules.manualWarnings(next, rules);
        Runnable save = () ->
          mutate(
            v -> {
              JSONObject e = VaultModel.find(v, id);
              e.put("rules", rules);
              VaultModel.stage(e, next, again);
            },
            () -> detail(id, "current")
          );
        if (warnings.isEmpty()) save.run();
        else confirm(
          "Preserve exactly as entered?",
          String.join("\n", warnings) +
            "\n\nContinue only if these details are intentional. No secret will be trimmed or altered.",
          save
        );
      } catch (Exception e) {
        error(new VaultCrypto.VaultException("Check your lengths and rules."));
      }
    });
  }

  private void copy(String value) {
    if (value.isEmpty()) {
      toast("No secret to copy.");
      return;
    }
    clearClipboard();
    ClipboardManager clipboard = (ClipboardManager) getSystemService(
      CLIPBOARD_SERVICE
    );
    ClipData clip = ClipData.newPlainText("Vaultriad secret", value);
    PersistableBundle extras = new PersistableBundle();
    extras.putBoolean("android.content.extra.IS_SENSITIVE", true);
    clip.getDescription().setExtras(extras);
    clipboard.setPrimaryClip(clip);
    forgetClipboardFingerprint();
    copiedFingerprint = clipboardDigest(value);
    int seconds = vault
      .optJSONObject("preferences")
      .optInt("clipboardSeconds", 30);
    clipboardExpires =
      SystemClock.elapsedRealtime() +
      Math.max(5, Math.min(120, seconds)) * 1000L;
    clipboardClear = this::clearClipboard;
    main.postDelayed(
      clipboardClear,
      Math.max(5, Math.min(120, seconds)) * 1000L
    );
    toast(
      "Copied. Best-effort clear in " +
        seconds +
        " seconds. Android clipboard restrictions may retain copies."
    );
  }

  @Override
  public void onWindowFocusChanged(boolean focused) {
    super.onWindowFocusChanged(focused);
    if (
      focused &&
      copiedFingerprint != null &&
      SystemClock.elapsedRealtime() >= clipboardExpires
    ) clearClipboard();
  }

  private byte[] clipboardDigest(CharSequence value) {
    byte[] bytes = value.toString().getBytes(StandardCharsets.UTF_8);
    try {
      return MessageDigest.getInstance("SHA-256").digest(bytes);
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("SHA-256 unavailable");
    } finally {
      Arrays.fill(bytes, (byte) 0);
    }
  }

  private void forgetClipboardFingerprint() {
    if (clipboardClear != null) main.removeCallbacks(clipboardClear);
    if (copiedFingerprint != null) Arrays.fill(copiedFingerprint, (byte) 0);
    copiedFingerprint = null;
    clipboardExpires = 0;
  }

  private void clearClipboard() {
    if (copiedFingerprint == null) return;
    try {
      ClipboardManager clipboard = (ClipboardManager) getSystemService(
        CLIPBOARD_SERVICE
      );
      ClipData clip = clipboard.getPrimaryClip();
      if (clip == null || clip.getItemCount() == 0) {
        if (hasWindowFocus()) forgetClipboardFingerprint();
        return;
      }
      byte[] actual = clipboardDigest(clip.getItemAt(0).coerceToText(this));
      boolean same = MessageDigest.isEqual(actual, copiedFingerprint);
      Arrays.fill(actual, (byte) 0);
      if (same) clipboard.clearPrimaryClip();
      forgetClipboardFingerprint();
    } catch (Exception ignored) {
      /* Retry an expired fingerprint on foreground focus; never retain the copied plaintext. */
    }
  }

  private void settings() {
    if (vault == null) {
      gate();
      return;
    }
    screen("Settings & backups");
    button("Back to vault", this::home);
    note(
      "Offline Android preview. Desktop supports additional import and rule-editing tools. Portable encrypted backups can transfer unbound vaults between them."
    );
    button("Export encrypted backup", () -> export(EXPORT));
    button("Security health", this::health);
    button("Auto-lock timeout", () -> {
      String[] labels = {
        "1 minute",
        "2 minutes",
        "5 minutes",
        "10 minutes",
        "15 minutes",
      };
      int[] values = { 1, 2, 5, 10, 15 };
      new AlertDialog.Builder(this)
        .setTitle("Auto-lock after inactivity")
        .setItems(labels, (d, index) ->
          mutate(
            v ->
              v
                .getJSONObject("preferences")
                .put("autoLockMinutes", values[index]),
            this::settings
          )
        )
        .show();
    });
    button("Clipboard timeout", () -> {
      String[] labels = {
        "5 seconds",
        "15 seconds",
        "30 seconds",
        "60 seconds",
      };
      int[] values = { 5, 15, 30, 60 };
      new AlertDialog.Builder(this)
        .setTitle("Clear clipboard after")
        .setItems(labels, (d, index) ->
          mutate(
            v ->
              v
                .getJSONObject("preferences")
                .put("clipboardSeconds", values[index]),
            this::settings
          )
        )
        .show();
    });
    button("Change unlock credentials", () ->
      verifyCredentials(c -> credentialsSetup(true))
    );
    button("Enable Android biometrics", () ->
      verifyCredentials(c -> enableBiometrics())
    );
    button("Disable Android biometrics", () ->
      task(
        () -> {
          deleteBiometrics();
          return true;
        },
        ok -> {
          toast("Biometric quick unlock disabled.");
          settings();
        }
      )
    );
    note(
      "Biometrics are optional, off by default and an alternative to all credential groups. Android uses supported strong fingerprint/face authentication—not Apple Touch ID."
    );
    button("Reset and start over", this::reset);
    button("About & license", this::about);
  }

  private void health() {
    screen("Security health");
    button("Back", this::settings);
    try {
      JSONArray entries = vault.getJSONArray("entries");
      Map<String, Integer> counts = new HashMap<>();
      for (int i = 0; i < entries.length(); i++) {
        String value = entries.getJSONObject(i).optString("current");
        if (!value.isEmpty()) counts.put(
          value,
          counts.getOrDefault(value, 0) + 1
        );
      }
      boolean found = false;
      for (int i = 0; i < entries.length(); i++) {
        JSONObject e = entries.getJSONObject(i);
        List<String> issues = new ArrayList<>();
        String current = e.optString("current");
        if (current.length() < 12 || current.matches("(.)\\1+")) issues.add(
          "Weak, short or missing Current"
        );
        if (counts.getOrDefault(current, 0) > 1) issues.add("Reused secret");
        if (!e.isNull("pending")) issues.add("Unresolved Pending");
        if (
          e.isNull("rotationDays") || e.optInt("rotationDays") == 0
        ) issues.add("No rotation reminder");
        else try {
          if (
            Instant.now().toEpochMilli() -
              Instant.parse(e.getString("rotatedAt")).toEpochMilli() >
            e.getLong("rotationDays") * 86400000L
          ) issues.add("Rotation due");
        } catch (Exception ignored) {}
        if (!issues.isEmpty()) {
          found = true;
          note(e.optString("name") + ": " + String.join(" · ", issues));
          String id = e.getString("id");
          button("Review " + e.optString("name"), () ->
            detail(id, e.isNull("pending") ? "new" : "current")
          );
        }
      }
      if (
        !header.factors.password ||
        !header.factors.pin ||
        header.factors.questions.length != 3
      ) note("Less protected: not all credential groups are enabled.");
      if (!found) note(
        "No entry issues detected by these local checks. This is not proof that a secret is safe."
      );
    } catch (Exception e) {
      error(e);
    }
  }

  private void reset() {
    EditText confirmation = new EditText(this);
    confirmation.setTextColor(FG);
    confirmation.setSingleLine(true);
    confirmation.setSaveEnabled(false);
    new AlertDialog.Builder(this)
      .setTitle("Reset and start over")
      .setMessage(
        "First export the existing encrypted vault. It will require its original credentials. Type RESET to continue. Nothing is wiped if export fails."
      )
      .setView(confirmation)
      .setNegativeButton("Cancel", null)
      .setPositiveButton("Choose backup destination", (d, w) -> {
        if (!confirmation.getText().toString().equals("RESET")) {
          toast("Reset cancelled: confirmation did not match.");
          return;
        }
        export(RESET);
      })
      .show();
  }

  private void export(int request) {
    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType("application/octet-stream");
    intent.putExtra(
      Intent.EXTRA_TITLE,
      "Vaultriad-" +
        (request == PREVIOUS ? "rolling-" : "") +
        System.currentTimeMillis() +
        ".vtbackup"
    );
    startActivityForResult(intent, request);
  }

  private void pickRestore() {
    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType("*/*");
    startActivityForResult(intent, RESTORE);
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (result != RESULT_OK || data == null || data.getData() == null) {
      gate();
      return;
    }
    Uri uri = data.getData();
    if (request == RESTORE) {
      task(
        () -> {
          try (InputStream in = getContentResolver().openInputStream(uri)) {
            String raw = VaultFiles.readLimited(in);
            VaultCrypto.inspect(raw);
            return raw;
          }
        },
        raw -> {
          try {
            restoreRaw = raw;
            header = VaultCrypto.inspect(raw);
            gate();
          } catch (Exception e) {
            error(e);
          }
        }
      );
    } else if (request == EXPORT || request == RESET || request == PREVIOUS) {
      task(
        () -> {
          String raw =
            request == PREVIOUS ? files.readPrevious() : files.read();
          byte[] bytes = raw.getBytes(StandardCharsets.UTF_8);
          try (
            OutputStream out = getContentResolver().openOutputStream(uri, "wt")
          ) {
            if (out == null) throw new IOException();
            out.write(bytes);
            out.flush();
          }
          String readback;
          try (InputStream in = getContentResolver().openInputStream(uri)) {
            readback = VaultFiles.readLimited(in);
          }
          if (
            !MessageDigest.isEqual(
              MessageDigest.getInstance("SHA-256").digest(bytes),
              MessageDigest.getInstance("SHA-256").digest(
                readback.getBytes(StandardCharsets.UTF_8)
              )
            )
          ) throw new VaultCrypto.VaultException(
            "Backup could not be verified. The current vault was preserved."
          );
          if (request == RESET) {
            files.resetAfterBackup();
            deleteBiometrics();
          }
          return true;
        },
        ok -> {
          if (request == RESET) {
            header = null;
            restoreRaw = null;
          }
          gate();
          toast(
            request == RESET
              ? "Encrypted backup verified. A clean vault can now be created."
              : "Encrypted backup verified. Keep a copy off this phone."
          );
        }
      );
    }
  }

  private String alias() {
    return getPackageName() + ".biometric.v1";
  }

  private boolean biometricsAvailable() {
    return (
      ((BiometricManager) getSystemService(BIOMETRIC_SERVICE)).canAuthenticate(
        BiometricManager.Authenticators.BIOMETRIC_STRONG
      ) == BiometricManager.BIOMETRIC_SUCCESS
    );
  }

  private void deleteBiometrics() throws Exception {
    new android.util.AtomicFile(files.biometricFile()).delete();
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    if (store.containsAlias(alias())) store.deleteEntry(alias());
  }

  private Cipher biometricCipher(boolean encrypt, byte[] iv) throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    if (encrypt) {
      KeyGenerator generator = KeyGenerator.getInstance(
        KeyProperties.KEY_ALGORITHM_AES,
        "AndroidKeyStore"
      );
      generator.init(
        new KeyGenParameterSpec.Builder(
          alias(),
          KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
          .setKeySize(256)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setUserAuthenticationRequired(true)
          .setUserAuthenticationParameters(
            0,
            KeyProperties.AUTH_BIOMETRIC_STRONG
          )
          .setInvalidatedByBiometricEnrollment(true)
          .build()
      );
      generator.generateKey();
    }
    SecretKey wrapping = (SecretKey) store.getKey(alias(), null);
    if (wrapping == null) throw new VaultCrypto.VaultException(
      "Biometric key unavailable. Use your full credentials."
    );
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    if (encrypt) cipher.init(Cipher.ENCRYPT_MODE, wrapping);
    else cipher.init(
      Cipher.DECRYPT_MODE,
      wrapping,
      new GCMParameterSpec(128, iv)
    );
    return cipher;
  }

  private void prompt(Cipher cipher, String title, Consumer<Cipher> success) {
    int generation = epoch;
    biometricSignal = new CancellationSignal();
    new BiometricPrompt.Builder(this)
      .setTitle(title)
      .setSubtitle("Vaultriad · Strong device biometrics")
      .setAllowedAuthenticators(
        BiometricManager.Authenticators.BIOMETRIC_STRONG
      )
      .setNegativeButton("Cancel", getMainExecutor(), (dialog, which) -> {})
      .build()
      .authenticate(
        new BiometricPrompt.CryptoObject(cipher),
        biometricSignal,
        getMainExecutor(),
        new BiometricPrompt.AuthenticationCallback() {
          @Override
          public void onAuthenticationSucceeded(
            BiometricPrompt.AuthenticationResult result
          ) {
            if (generation != epoch || !active) return;
            biometricSignal = null;
            success.accept(result.getCryptoObject().getCipher());
          }

          @Override
          public void onAuthenticationError(int code, CharSequence message) {
            if (generation == epoch && active) toast(
              "Biometric unlock unavailable or cancelled. Use full credentials."
            );
          }
        }
      );
  }

  private void enableBiometrics() {
    if (vault == null || !biometricsAvailable()) {
      error(
        new VaultCrypto.VaultException(
          "Enroll a supported strong fingerprint or face biometric in Android Settings first."
        )
      );
      return;
    }
    try {
      Cipher cipher = biometricCipher(true, null);
      prompt(cipher, "Enable Vaultriad biometrics", authenticated -> {
        try {
          if (key == null) return;
          String salt = header.salt;
          byte[] wrapped = authenticated.doFinal(key);
          String raw = new JSONObject()
            .put("salt", salt)
            .put(
              "iv",
              java.util.Base64.getEncoder().encodeToString(
                authenticated.getIV()
              )
            )
            .put("data", java.util.Base64.getEncoder().encodeToString(wrapped))
            .toString();
          task(
            () -> {
              VaultFiles.writeBiometric(files.biometricFile(), raw);
              return true;
            },
            ok -> {
              toast(
                "Biometric quick unlock enabled. Keep your original credentials for backups."
              );
              settings();
            }
          );
        } catch (Exception e) {
          error(e);
        }
      });
    } catch (Exception e) {
      error(
        new VaultCrypto.VaultException(
          "Secure biometric key setup failed. Full credential unlock remains available."
        )
      );
    }
  }

  private void quickUnlock() {
    if (SystemClock.elapsedRealtime() < retryAt) {
      toast("Please wait before trying again.");
      return;
    }
    if (!biometricsAvailable()) {
      error(
        new VaultCrypto.VaultException(
          "Strong biometrics are unavailable. Use your full credentials."
        )
      );
      return;
    }
    task(
      () -> {
        try (InputStream in = new FileInputStream(files.biometricFile())) {
          return new JSONObject(VaultFiles.readLimited(in));
        }
      },
      wrapped -> {
        try {
          if (
            !header.salt.equals(wrapped.getString("salt"))
          ) throw new Exception();
          Cipher cipher = biometricCipher(
            false,
            java.util.Base64.getDecoder().decode(wrapped.getString("iv"))
          );
          prompt(cipher, "Unlock Vaultriad", authenticated -> {
            byte[] candidate = null;
            try {
              candidate = authenticated.doFinal(
                java.util.Base64.getDecoder().decode(wrapped.getString("data"))
              );
              final byte[] working = candidate;
              candidate = null;
              task(() -> {
                try {
                  String raw = files.read();
                  return new Session(
                    VaultCrypto.open(raw, working),
                    working,
                    VaultCrypto.inspect(raw)
                  );
                } catch (Exception e) {
                  Arrays.fill(working, (byte) 0);
                  throw e;
                }
              }, this::accept);
            } catch (Exception e) {
              if (candidate != null) Arrays.fill(candidate, (byte) 0);
              error(
                new VaultCrypto.VaultException(
                  "Biometric unlock failed. Use your full credentials."
                )
              );
            }
          });
        } catch (Exception e) {
          error(
            new VaultCrypto.VaultException(
              "Biometric key unavailable or invalidated. Use your full credentials and re-enable biometrics."
            )
          );
        }
      }
    );
  }

  private void about() {
    screen("About Vaultriad");
    note(
      "Vaultriad Android 1.0.0 preview\nMIT free and open-source software\nAES-256-GCM · Argon2id (64 MiB, 3 iterations)\nAndroid 11+ · No Internet permission\nApp ID: " +
        getPackageName()
    );
    note(
      "Source: https://github.com/felixzax/Vaultriad\n\nA compromised OS, keyboard, accessibility service, clipboard history or someone using the unlocked vault can expose secrets. Java strings cannot be reliably wiped. Biometrics are an optional alternative unlock route. Keep encrypted off-phone backups; uninstalling deletes local data. This preview has not been independently audited."
    );
    button("Read MIT license", () ->
      task(
        () -> {
          try (InputStream in = getAssets().open("LICENSE.txt")) {
            return VaultFiles.readLimited(in);
          }
        },
        license ->
          new AlertDialog.Builder(this)
            .setTitle("MIT License")
            .setMessage(license)
            .setPositiveButton("Close", null)
            .show()
      )
    );
    button("Back", () -> {
      if (vault != null) settings();
      else gate();
    });
  }
}
