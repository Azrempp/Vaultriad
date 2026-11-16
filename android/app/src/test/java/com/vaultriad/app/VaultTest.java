package com.vaultriad.app;

import static org.junit.Assert.*;

import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.json.*;
import org.junit.Test;

public class VaultTest {

  private VaultCrypto.Credentials credentials() {
    return new VaultCrypto.Credentials(
      "portable </script> 🔒 example password",
      "096381",
      new String[] { " mr fluffy ", " OAK   STREET! ", "café école" }
    );
  }

  private String fixture() throws Exception {
    try (
      java.io.InputStream stream = getClass().getResourceAsStream(
        "/desktop-portable.vtbackup"
      )
    ) {
      return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
    }
  }

  @Test
  public void desktopBackupDecryptsAndAndroidBackupIsWrittenForDesktopVerification() throws Exception {
    String raw = fixture();
    VaultCrypto.Envelope e = VaultCrypto.inspect(raw);
    byte[] key = VaultCrypto.derive(credentials(), e.factors, e.salt);
    try {
      JSONObject v = VaultCrypto.open(raw, key);
      assertEquals(
        "Desktop fixture",
        v.getJSONArray("entries").getJSONObject(0).getString("name")
      );
      assertEquals(
        "Synthetic-current-secret!42",
        v.getJSONArray("entries").getJSONObject(0).getString("current")
      );
      String sealed = VaultCrypto.seal(v, key, e.factors, e.salt);
      assertEquals(v.toString(), VaultCrypto.open(sealed, key).toString());
      assertNotEquals(
        e.body.getString("nonce"),
        VaultCrypto.inspect(sealed).body.getString("nonce")
      );
      Path file = Path.of("build/reports/android-portable.vtbackup");
      Files.createDirectories(file.getParent());
      Files.write(file, sealed.getBytes(StandardCharsets.UTF_8));
    } finally {
      Arrays.fill(key, (byte) 0);
    }
  }

  @Test
  public void eachMissingOrWrongFactorFails() throws Exception {
    String raw = fixture();
    VaultCrypto.Envelope e = VaultCrypto.inspect(raw);
    VaultCrypto.Credentials c = credentials();
    VaultCrypto.Credentials[] wrong = {
      new VaultCrypto.Credentials("", c.pin, c.answers),
      new VaultCrypto.Credentials(c.password, "", c.answers),
      new VaultCrypto.Credentials(c.password, c.pin, new String[0]),
      new VaultCrypto.Credentials("wrong", c.pin, c.answers),
      new VaultCrypto.Credentials(c.password, "000000", c.answers),
      new VaultCrypto.Credentials(c.password, c.pin, new String[] {
        "wrong",
        "oak street",
        "café école",
      }),
    };
    for (VaultCrypto.Credentials input : wrong) {
      byte[] key = VaultCrypto.derive(input, e.factors, e.salt);
      try {
        assertThrows(Exception.class, () -> VaultCrypto.open(raw, key));
      } finally {
        Arrays.fill(key, (byte) 0);
      }
    }
  }

  @Test
  public void normalizedAnswersMatchDesktop() {
    assertEquals("mr fluffy", VaultCrypto.normalize("  Mr.   FLUFFY!  "));
    assertEquals("café école", VaultCrypto.normalize("Café / École"));
    assertEquals("oak street", VaultCrypto.normalize("OAK\u00a0STREET!"));
    assertEquals("ab", VaultCrypto.normalize("a\u0085b"));
  }

  @Test
  public void javascriptQuotingDoesNotEscapeSlashOrBreakUnicode() {
    assertEquals("\"</script> 🔒\"", VaultCrypto.quote("</script> 🔒"));
    assertEquals("\"\\ud800\"", VaultCrypto.quote("\ud800"));
    assertEquals("\"a\\nb\"", VaultCrypto.quote("a\nb"));
  }

  @Test
  public void tamperAndBoundBackupsAreRejected() throws Exception {
    String raw = fixture();
    VaultCrypto.Envelope e = VaultCrypto.inspect(raw);
    byte[] key = VaultCrypto.derive(credentials(), e.factors, e.salt);
    try {
      JSONObject mac = new JSONObject(raw).put("mac", "0".repeat(64));
      assertThrows(Exception.class, () ->
        VaultCrypto.open(mac.toString(), key)
      );
      JSONObject outer = new JSONObject(raw),
        body = new JSONObject(outer.getString("payload"));
      body.put("tag", "0".repeat(32));
      outer.put("payload", body.toString());
      assertThrows(Exception.class, () ->
        VaultCrypto.open(outer.toString(), key)
      );
      body.getJSONObject("factors").put("bound", true);
      outer.put("payload", body.toString());
      assertThrows(VaultCrypto.VaultException.class, () ->
        VaultCrypto.inspect(outer.toString())
      );
    } finally {
      Arrays.fill(key, (byte) 0);
    }
  }

  @Test
  public void generatorEnforcesPresetsAndRestrictions() throws Exception {
    for (String cat : new String[] { "hardware", "domains", "api" }) {
      JSONObject rules = PasswordRules.preset(cat);
      for (int i = 0; i < 40; i++) {
        String generated = PasswordRules.generate(rules);
        assertEquals(rules.getInt("length"), generated.length());
        assertTrue(PasswordRules.warnings(generated, rules).isEmpty());
        assertFalse(generated.matches(".*[0O1lI].*"));
      }
    }
    JSONObject impossible = PasswordRules.preset("domains")
      .put("allowed", "")
      .put(
        "excluded",
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+"
      );
    assertThrows(VaultCrypto.VaultException.class, () ->
      PasswordRules.generate(impossible)
    );
    JSONObject alternating = PasswordRules.preset("hardware")
      .put("upper", false)
      .put("numbers", false)
      .put("symbols", false)
      .put("allowed", "ab")
      .put("length", 128);
    assertEquals(128, PasswordRules.generate(alternating).length());
  }

  @Test
  public void pendingPromotionAndDiscardPreserveCurrentAndHistory() throws Exception {
    JSONObject e = VaultModel.create(
      "Router",
      "admin",
      "192.168.1.1",
      "",
      "",
      "hardware"
    ).put("current", "working");
    VaultModel.stage(e, "replacement", "replacement");
    assertEquals("working", e.getString("current"));
    assertThrows(VaultCrypto.VaultException.class, () ->
      VaultModel.stage(e, "another", "another")
    );
    VaultModel.resolve(e, false);
    assertEquals("working", e.getString("current"));
    assertEquals(0, e.getJSONArray("past").length());
    VaultModel.stage(e, "replacement", "replacement");
    VaultModel.resolve(e, true);
    assertEquals("replacement", e.getString("current"));
    assertEquals(
      "working",
      e.getJSONArray("past").getJSONObject(0).getString("value")
    );
    assertTrue(e.isNull("pending"));
  }

  @Test
  public void manualSecretsAreNeverTrimmedOrNormalized() throws Exception {
    JSONObject e = VaultModel.create("SSH", "id", "", "", "", "api");
    String secret = "  line one\r\nline two  ";
    VaultModel.stage(e, secret, secret);
    assertEquals(secret, e.getJSONObject("pending").getString("value"));
    assertThrows(VaultCrypto.VaultException.class, () ->
      VaultModel.stage(
        VaultModel.create("Other", "", "", "", "", "api"),
        "one",
        "two"
      )
    );
  }

  @Test
  public void setupRequiresAGroupAndThreeDistinctAnsweredQuestions() throws Exception {
    assertThrows(VaultCrypto.VaultException.class, () ->
      VaultCrypto.validateSetup(
        new VaultCrypto.Factors(false, false, new String[0]),
        credentials()
      )
    );
    assertThrows(VaultCrypto.VaultException.class, () ->
      VaultCrypto.validateSetup(
        new VaultCrypto.Factors(false, true, new String[0]),
        new VaultCrypto.Credentials("", "12", new String[0])
      )
    );
    assertThrows(VaultCrypto.VaultException.class, () ->
      VaultCrypto.validateSetup(
        new VaultCrypto.Factors(false, false, new String[] {
          "same",
          "same",
          "third",
        }),
        credentials()
      )
    );
  }
}
