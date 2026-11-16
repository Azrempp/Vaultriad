package com.vaultriad.app;

import java.time.Instant;
import java.util.*;
import org.json.*;

public final class VaultModel {

  public static String now() {
    return Instant.now().toString();
  }

  public static JSONObject empty() throws JSONException {
    JSONObject p = new JSONObject()
      .put("advanced", false)
      .put("theme", "dark")
      .put("reducedMotion", false)
      .put("autoLockMinutes", 5)
      .put("clipboardSeconds", 30)
      .put("rotationReminders", true)
      .put("breachEnabled", false)
      .put("backupDirectory", "")
      .put("lastBackupAt", JSONObject.NULL);
    return new JSONObject()
      .put("version", 1)
      .put("entries", new JSONArray())
      .put("preferences", p)
      .put("presets", new JSONArray());
  }

  public static JSONObject create(
    String name,
    String username,
    String location,
    String notes,
    String tags,
    String category
  ) throws Exception {
    if (
      name.trim().isEmpty() || name.length() > 200
    ) throw new VaultCrypto.VaultException(
      "Enter a name with at most 200 characters."
    );
    JSONObject e = new JSONObject();
    String now = now();
    e.put("id", UUID.randomUUID().toString())
      .put("name", name.trim())
      .put("username", username)
      .put("location", location)
      .put("notes", notes)
      .put("tags", new JSONArray())
      .put("category", category)
      .put("createdAt", now)
      .put("updatedAt", now)
      .put("rotatedAt", now)
      .put("rotationDays", 90)
      .put("rules", PasswordRules.preset(category))
      .put("current", "")
      .put("past", new JSONArray())
      .put("pending", JSONObject.NULL);
    for (String tag : tags.split(","))
      if (!tag.trim().isEmpty()) e.getJSONArray("tags").put(tag.trim());
    return e;
  }

  public static JSONObject find(JSONObject vault, String id) throws Exception {
    JSONArray entries = vault.getJSONArray("entries");
    for (int i = 0; i < entries.length(); i++) {
      JSONObject e = entries.getJSONObject(i);
      if (id.equals(e.getString("id"))) return e;
    }
    throw new VaultCrypto.VaultException("Entry not found.");
  }

  public static void stage(
    JSONObject entry,
    String secret,
    String confirm
  ) throws Exception {
    if (!secret.equals(confirm)) throw new VaultCrypto.VaultException(
      "The secrets do not match."
    );
    if (secret.isEmpty()) throw new VaultCrypto.VaultException(
      "Enter a secret."
    );
    if (secret.length() > 20000) throw new VaultCrypto.VaultException(
      "The secret exceeds the mobile size limit."
    );
    if (!entry.isNull("pending")) throw new VaultCrypto.VaultException(
      "Resolve the existing Pending secret first."
    );
    entry
      .put(
        "pending",
        new JSONObject().put("value", secret).put("createdAt", now())
      )
      .put("updatedAt", now());
  }

  public static void resolve(
    JSONObject entry,
    boolean worked
  ) throws Exception {
    if (entry.isNull("pending")) throw new VaultCrypto.VaultException(
      "No Pending secret."
    );
    if (worked) {
      String old = entry.getString("current");
      JSONArray history = new JSONArray();
      if (!old.isEmpty()) history.put(
        new JSONObject()
          .put("id", UUID.randomUUID().toString())
          .put("value", old)
          .put("replacedAt", now())
      );
      JSONArray past = entry.getJSONArray("past");
      for (int i = 0; i < past.length(); i++) history.put(past.get(i));
      entry
        .put("past", history)
        .put("current", entry.getJSONObject("pending").getString("value"))
        .put("rotatedAt", now());
    }
    entry.put("pending", JSONObject.NULL).put("updatedAt", now());
  }

  public static void remove(JSONArray array, int index) {
    array.remove(index);
  }
}
