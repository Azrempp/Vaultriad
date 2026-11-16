package com.vaultriad.app;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.text.Normalizer;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.*;
import org.bouncycastle.crypto.generators.Argon2BytesGenerator;
import org.bouncycastle.crypto.params.Argon2Parameters;
import org.json.*;

/** Desktop-compatible, unbound VAULTRIAD-BACKUP v1 encryption. No Android or UI dependencies. */
public final class VaultCrypto {

  public static final int MAX_BYTES = 32 * 1024 * 1024;
  private static final SecureRandom RANDOM = new SecureRandom();
  public static final String KDF = "argon2id-64m-t3-p1";
  private static final String WS =
    "[\\t\\n\\r\\f\\x0B \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]";
  public static final String[] QUESTIONS = {
    "What was the name of your first pet?",
    "What street did you grow up on?",
    "What was your first school?",
    "What was your childhood nickname?",
    "In which city did you meet your partner?",
    "What was your first car model?",
  };

  public static class VaultException extends Exception {

    public VaultException(String message) {
      super(message);
    }
  }

  public static final class Credentials {

    public final String password, pin;
    public final String[] answers;

    public Credentials(String password, String pin, String[] answers) {
      this.password = password;
      this.pin = pin;
      this.answers = answers;
    }
  }

  public static final class Factors {

    public final boolean password, pin;
    public final String[] questions;

    public Factors(boolean password, boolean pin, String[] questions) {
      this.password = password;
      this.pin = pin;
      this.questions = questions;
    }

    public String json() {
      return (
        "{\"password\":" +
        password +
        ",\"pin\":" +
        pin +
        ",\"questions\":" +
        strings(questions) +
        ",\"bound\":false}"
      );
    }
  }

  public static final class Envelope {

    public final JSONObject body;
    public final String payload, mac, salt;
    public final Factors factors;

    Envelope(
      JSONObject body,
      String payload,
      String mac,
      String salt,
      Factors factors
    ) {
      this.body = body;
      this.payload = payload;
      this.mac = mac;
      this.salt = salt;
      this.factors = factors;
    }
  }

  /** JSON.stringify-compatible quoting, including literal </ and escaped lone surrogates. */
  public static String quote(String s) {
    StringBuilder out = new StringBuilder("\"");
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"':
          out.append("\\\"");
          break;
        case '\\':
          out.append("\\\\");
          break;
        case '\b':
          out.append("\\b");
          break;
        case '\f':
          out.append("\\f");
          break;
        case '\n':
          out.append("\\n");
          break;
        case '\r':
          out.append("\\r");
          break;
        case '\t':
          out.append("\\t");
          break;
        default:
          if (
            c < 32 ||
            (Character.isSurrogate(c) &&
              !(
                Character.isHighSurrogate(c) &&
                i + 1 < s.length() &&
                Character.isLowSurrogate(s.charAt(i + 1))
              ) &&
              !(
                Character.isLowSurrogate(c) &&
                i > 0 &&
                Character.isHighSurrogate(s.charAt(i - 1))
              ))
          ) out.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
          else out.append(c);
      }
    }
    return out.append('"').toString();
  }

  private static String strings(String[] values) {
    StringJoiner j = new StringJoiner(",", "[", "]");
    for (String s : values) j.add(quote(s));
    return j.toString();
  }

  public static String normalize(String answer) {
    return Normalizer.normalize(answer, Normalizer.Form.NFKC)
      .toLowerCase(Locale.ROOT)
      .replaceAll("[^\\p{L}\\p{N}" + WS.substring(1, WS.length() - 1) + "]", "")
      .replaceAll(WS + "+", " ")
      .trim();
  }

  public static void validateSetup(
    Factors f,
    Credentials c
  ) throws VaultException {
    if (
      !f.password && !f.pin && f.questions.length == 0
    ) throw new VaultException("Choose at least one credential group.");
    if (f.password && c.password.isEmpty()) throw new VaultException(
      "Enter a master password."
    );
    if (f.pin && !c.pin.matches("[0-9]{6,12}")) throw new VaultException(
      "PIN must contain 6–12 digits."
    );
    if (f.questions.length != 0) {
      if (
        f.questions.length != 3 ||
        new HashSet<>(Arrays.asList(f.questions)).size() != 3
      ) throw new VaultException("Choose three different questions.");
      if (c.answers.length != 3) throw new VaultException(
        "Answer all three questions."
      );
      for (String a : c.answers)
        if (normalize(a).isEmpty()) throw new VaultException(
          "Answer all three questions."
        );
    }
  }

  public static byte[] derive(Credentials c, Factors f, String salt) {
    String[] a = new String[c.answers.length];
    for (int i = 0; i < a.length; i++) a[i] = normalize(c.answers[i]);
    String material =
      "[" +
      (f.password ? quote(c.password) : "null") +
      "," +
      (f.pin ? quote(c.pin) : "null") +
      "," +
      (f.questions.length > 0 ? strings(a) : "null") +
      ",null]";
    byte[] bytes = material.getBytes(StandardCharsets.UTF_8),
      key = new byte[32];
    Argon2BytesGenerator generator = new Argon2BytesGenerator();
    Argon2Parameters p = new Argon2Parameters.Builder(
      Argon2Parameters.ARGON2_id
    )
      .withVersion(Argon2Parameters.ARGON2_VERSION_13)
      .withSalt(unhex(salt))
      .withMemoryAsKB(65536)
      .withIterations(3)
      .withParallelism(1)
      .build();
    try {
      generator.init(p);
      generator.generateBytes(bytes, key);
      return key;
    } finally {
      Arrays.fill(bytes, (byte) 0);
      p.clear();
    }
  }

  private static String aad(Envelope e) throws JSONException {
    return (
      "{\"magic\":\"VAULTRIAD\",\"version\":1,\"kdf\":\"" +
      KDF +
      "\",\"salt\":" +
      quote(e.salt) +
      ",\"nonce\":" +
      quote(e.body.getString("nonce")) +
      ",\"factors\":" +
      e.factors.json() +
      "}"
    );
  }

  public static String seal(
    JSONObject vault,
    byte[] key,
    Factors factors,
    String salt
  ) throws Exception {
    byte[] plain = vault.toString().getBytes(StandardCharsets.UTF_8);
    if (plain.length > 20 * 1024 * 1024) throw new VaultException(
      "Vault exceeds the mobile size limit. No changes were saved."
    );
    try {
      JSONObject body = new JSONObject();
      body.put("magic", "VAULTRIAD");
      body.put("version", 1);
      body.put("kdf", KDF);
      body.put("salt", salt);
      body.put("nonce", hex(random(12)));
      body.put("factors", new JSONObject(factors.json()));
      Envelope e = new Envelope(body, "", "", salt, factors);
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(
        Cipher.ENCRYPT_MODE,
        new SecretKeySpec(key, "AES"),
        new GCMParameterSpec(128, unhex(body.getString("nonce")))
      );
      cipher.updateAAD(aad(e).getBytes(StandardCharsets.UTF_8));
      byte[] encrypted = cipher.doFinal(plain);
      body.put(
        "data",
        Base64.getEncoder().encodeToString(
          Arrays.copyOf(encrypted, encrypted.length - 16)
        )
      );
      body.put(
        "tag",
        hex(
          Arrays.copyOfRange(encrypted, encrypted.length - 16, encrypted.length)
        )
      );
      String payload = body.toString();
      return new JSONObject()
        .put("magic", "VAULTRIAD-BACKUP")
        .put("version", 1)
        .put("payload", payload)
        .put("mac", mac(payload, key))
        .toString();
    } finally {
      Arrays.fill(plain, (byte) 0);
    }
  }

  public static Envelope inspect(String raw) throws Exception {
    if (
      raw.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES
    ) throw new VaultException("Backup exceeds the mobile size limit.");
    JSONObject outer = new JSONObject(raw);
    if (
      !"VAULTRIAD-BACKUP".equals(outer.getString("magic")) ||
      outer.getInt("version") != 1
    ) throw new VaultException("Not a supported Vaultriad backup.");
    String payload = outer.getString("payload"),
      mac = outer.getString("mac");
    JSONObject e = new JSONObject(payload);
    JSONObject f = e.getJSONObject("factors");
    if (f.getBoolean("bound")) throw new VaultException(
      "This backup is bound to its original computer. Export a portable backup from the desktop app first."
    );
    JSONArray qs = f.getJSONArray("questions");
    if (qs.length() != 0 && qs.length() != 3) throw new VaultException(
      "Invalid backup credential settings."
    );
    String[] questions = new String[qs.length()];
    for (int i = 0; i < questions.length; i++) {
      questions[i] = qs.getString(i);
      if (questions[i].length() > 200) throw new VaultException(
        "Invalid backup credential settings."
      );
    }
    Factors factors = new Factors(
      f.getBoolean("password"),
      f.getBoolean("pin"),
      questions
    );
    if (
      !factors.password && !factors.pin && questions.length == 0
    ) throw new VaultException("Invalid backup credential settings.");
    String salt = e.getString("salt");
    if (
      !"VAULTRIAD".equals(e.getString("magic")) ||
      e.getInt("version") != 1 ||
      !KDF.equals(e.getString("kdf")) ||
      !salt.matches("[a-f0-9]{32}") ||
      !e.getString("nonce").matches("[a-f0-9]{24}") ||
      !e.getString("tag").matches("[a-f0-9]{32}") ||
      !mac.matches("[a-f0-9]{64}")
    ) throw new VaultException("Unsupported or modified backup header.");
    return new Envelope(e, payload, mac, salt, factors);
  }

  public static JSONObject open(String raw, byte[] key) throws Exception {
    Envelope e = inspect(raw);
    if (
      !MessageDigest.isEqual(unhex(e.mac), unhex(mac(e.payload, key)))
    ) throw new VaultException("Credential or backup integrity check failed.");
    byte[] data = Base64.getDecoder().decode(e.body.getString("data")),
      tag = unhex(e.body.getString("tag")),
      all = Arrays.copyOf(data, data.length + tag.length);
    System.arraycopy(tag, 0, all, data.length, tag.length);
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(
      Cipher.DECRYPT_MODE,
      new SecretKeySpec(key, "AES"),
      new GCMParameterSpec(128, unhex(e.body.getString("nonce")))
    );
    cipher.updateAAD(aad(e).getBytes(StandardCharsets.UTF_8));
    byte[] plain = cipher.doFinal(all);
    try {
      JSONObject v = new JSONObject(new String(plain, StandardCharsets.UTF_8));
      if (
        v.getInt("version") != 1 ||
        v.optJSONArray("entries") == null ||
        v.optJSONObject("preferences") == null
      ) throw new VaultException("Unsupported vault data.");
      return v;
    } finally {
      Arrays.fill(plain, (byte) 0);
    }
  }

  private static String mac(String payload, byte[] key) throws Exception {
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(key, "HmacSHA256"));
    mac.update("VAULTRIAD-BACKUP-v1\0".getBytes(StandardCharsets.UTF_8));
    return hex(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
  }

  public static String salt() {
    return hex(random(16));
  }

  public static byte[] random(int n) {
    byte[] b = new byte[n];
    RANDOM.nextBytes(b);
    return b;
  }

  public static String hex(byte[] b) {
    StringBuilder s = new StringBuilder(b.length * 2);
    for (byte v : b) s.append(String.format(Locale.ROOT, "%02x", v & 255));
    return s.toString();
  }

  public static byte[] unhex(String h) {
    byte[] b = new byte[h.length() / 2];
    for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(
      h.substring(2 * i, 2 * i + 2),
      16
    );
    return b;
  }
}
