package com.vaultriad.app;

import java.security.SecureRandom;
import java.util.*;
import org.json.*;

public final class PasswordRules {

  private static final SecureRandom RANDOM = new SecureRandom();

  public static JSONObject preset(String category) throws JSONException {
    return new JSONObject()
      .put("min", 8)
      .put("max", 128)
      .put(
        "length",
        category.equals("api") ? 40 : category.equals("domains") ? 16 : 20
      )
      .put("upper", true)
      .put("lower", true)
      .put("numbers", true)
      .put("symbols", !category.equals("api"))
      .put("allowedSymbols", "!@#$%^&*()-_=+")
      .put("allowed", "")
      .put("excluded", "")
      .put("ambiguous", true)
      .put("minUpper", 1)
      .put("minLower", 1)
      .put("minNumbers", 1)
      .put("minSymbols", category.equals("api") ? 0 : 1)
      .put("noRepeat", true)
      .put("truncates", JSONObject.NULL)
      .put("mode", "password")
      .put("words", 8)
      .put("separator", "-")
      .put("capitalize", false);
  }

  private static List<String> chars(String s) {
    List<String> list = new ArrayList<>();
    s.codePoints().forEach(c -> list.add(new String(Character.toChars(c))));
    return list;
  }

  private static int group(String c) {
    if (c.matches("[A-Z]")) return 0;
    if (c.matches("[a-z]")) return 1;
    if (c.matches("[0-9]")) return 2;
    return 3;
  }

  private static int[] minimums(JSONObject r) {
    return new int[] {
      r.optBoolean("upper") ? r.optInt("minUpper") : 0,
      r.optBoolean("lower") ? r.optInt("minLower") : 0,
      r.optBoolean("numbers") ? r.optInt("minNumbers") : 0,
      r.optBoolean("symbols") ? r.optInt("minSymbols") : 0,
    };
  }

  public static List<String> warnings(String value, JSONObject r) {
    List<String> errors = new ArrayList<>();
    List<String> cs = chars(value);
    if (cs.size() < r.optInt("min", 8)) errors.add("Below the minimum length.");
    if (cs.size() > r.optInt("max", 128)) errors.add(
      "Above the maximum length."
    );
    if (
      !r.isNull("truncates") &&
      r.optInt("truncates") > 0 &&
      cs.size() > r.optInt("truncates")
    ) errors.add("The service may truncate this secret.");
    int[] counts = new int[4],
      mins = minimums(r);
    String previous = null;
    for (String c : cs) {
      counts[group(c)]++;
      if (
        !r.optString("allowed").isEmpty() &&
        !r.optString("allowed").contains(c) &&
        !errors.contains("Contains characters outside the allowed set.")
      ) errors.add("Contains characters outside the allowed set.");
      if (
        r.optString("excluded").contains(c) &&
        !errors.contains("Contains excluded characters.")
      ) errors.add("Contains excluded characters.");
      if (
        r.optBoolean("noRepeat") &&
        c.equals(previous) &&
        !errors.contains("Consecutive repeated characters.")
      ) errors.add("Consecutive repeated characters.");
      previous = c;
    }
    for (int i = 0; i < 4; i++) if (counts[i] < mins[i]) {
      errors.add("Required character counts are not met.");
      break;
    }
    return errors;
  }

  public static List<String> manualWarnings(String value, JSONObject rules) {
    List<String> errors = warnings(value, rules);
    if (!value.equals(value.trim())) errors.add(
      "Leading/trailing spaces will be preserved exactly."
    );
    if (value.matches("(?s).*[0O1lI].*")) errors.add(
      "Contains look-alike characters (0/O or 1/l/I)."
    );
    return errors;
  }

  public static String generate(JSONObject r) throws Exception {
    if (r.optString("mode", "password").equals("passphrase")) {
      for (int attempt = 0; attempt < 2000; attempt++) {
        StringJoiner value = new StringJoiner(r.optString("separator", "-"));
        int words = r.optInt("words", 8);
        if (words < 3 || words > 16) throw new VaultCrypto.VaultException(
          "Passphrase word count must be 3–16."
        );
        for (int i = 0; i < words; i++) {
          String word = WORDS[RANDOM.nextInt(WORDS.length)];
          value.add(
            r.optBoolean("capitalize")
              ? word.substring(0, 1).toUpperCase(Locale.ROOT) +
                  word.substring(1)
              : word
          );
        }
        if (warnings(value.toString(), r).isEmpty()) return value.toString();
      }
      throw new VaultCrypto.VaultException(
        "The passphrase cannot satisfy these rules. Adjust the entry rules on desktop or use password mode."
      );
    }
    int length = r.optInt("length", 20);
    if (
      length < 8 ||
      length > 128 ||
      length < r.optInt("min", 8) ||
      length > r.optInt("max", 128) ||
      (!r.isNull("truncates") &&
        r.optInt("truncates") > 0 &&
        length > r.optInt("truncates"))
    ) throw new VaultCrypto.VaultException(
      "Impossible length/truncation rules."
    );
    String[] source = {
      r.optBoolean("upper") ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ" : "",
      r.optBoolean("lower") ? "abcdefghijklmnopqrstuvwxyz" : "",
      r.optBoolean("numbers") ? "0123456789" : "",
      r.optBoolean("symbols") ? r.optString("allowedSymbols", "!@#$%") : "",
    };
    List<List<String>> pools = new ArrayList<>();
    LinkedHashSet<String> all = new LinkedHashSet<>();
    int[] mins = minimums(r);
    for (int i = 0; i < 4; i++) {
      List<String> pool = new ArrayList<>();
      for (String c : chars(source[i])) {
        if (i == 3 && group(c) != 3) continue;
        if (r.optBoolean("ambiguous") && "0O1lI".contains(c)) continue;
        if (r.optString("excluded").contains(c)) continue;
        if (
          !r.optString("allowed").isEmpty() &&
          !r.optString("allowed").contains(c)
        ) continue;
        if (!pool.contains(c)) pool.add(c);
      }
      if (pool.isEmpty() && mins[i] > 0) throw new VaultCrypto.VaultException(
        "Impossible character rules."
      );
      pools.add(pool);
      all.addAll(pool);
    }
    if (
      all.isEmpty() || Arrays.stream(mins).sum() > length
    ) throw new VaultCrypto.VaultException("Impossible character rules.");
    for (int attempt = 0; attempt < 2000; attempt++) {
      List<String> out = new ArrayList<>();
      int[] remaining = mins.clone();
      for (int position = 0; position < length; position++) {
        int slots = length - position - 1;
        List<String> candidates = new ArrayList<>();
        for (String c : all) {
          if (
            r.optBoolean("noRepeat") &&
            !out.isEmpty() &&
            c.equals(out.get(out.size() - 1))
          ) continue;
          int[] next = remaining.clone();
          if (next[group(c)] > 0) next[group(c)]--;
          if (Arrays.stream(next).sum() > slots) continue;
          boolean impossible = false;
          if (r.optBoolean("noRepeat")) for (int i = 0; i < 4; i++) if (
            pools.get(i).size() == 1 &&
            next[i] > (slots + (pools.get(i).get(0).equals(c) ? 0 : 1)) / 2
          ) impossible = true;
          if (!impossible) candidates.add(c);
        }
        if (candidates.isEmpty()) break;
        String chosen = candidates.get(RANDOM.nextInt(candidates.size()));
        if (remaining[group(chosen)] > 0) remaining[group(chosen)]--;
        out.add(chosen);
      }
      String value = String.join("", out);
      if (out.size() == length && warnings(value, r).isEmpty()) return value;
    }
    throw new VaultCrypto.VaultException(
      "Could not satisfy these password rules."
    );
  }

  private static final String[] WORDS =
    "acorn amber anchor apple apron arch arrow atlas autumn badge bamboo basin beach beacon berry birch blade bloom blue board boat bold bolt book boot bottle branch brass breeze brick bridge brook brush bubble bucket cabin cactus candle canyon cape cargo cedar chair chalk charm cherry chest circle citrus clay cliff cloud clover coast cobalt comet coral cotton crane creek crest crown crystal dawn deer delta desert dew diamond drift dune eagle earth echo elm ember engine fabric falcon feather fern field finch fire flame flask fleet flint float flower flute foam forest fork fox frame frost fruit garden gate gem ghost giant ginger glass globe glow gold goose grain grape grass green grove gull harbor harvest hawk hazel heart hedge heron hill honey horse ice iris island ivory ivy jade jar jasmine jewel juniper kettle key kite lake lamp lantern lark leaf lemon lens light lilac lime linen lion lotus lunar maple marble marsh meadow melon metal mint mist moon moss mountain mouse nest night north oak ocean olive onion opal orange orbit orchid otter owl palm panda paper peach pearl pebble pecan pine pink pipe planet plum pocket pond poppy port prism pumpkin quartz queen quill quilt rabbit rain raven reed reef ridge ring river road robin rock rose ruby sage sail salt sand satin scarf seed shade shell shore silk silver sky slate snow soap solar song south space sparrow spice spoon spring spruce square star steel stem stone storm straw stream sugar summer sun surf swan table tea teal thorn thyme tide tiger timber toast torch tower trail tree tulip turtle valley velvet vine violet walnut water wave wax west wheat wheel white willow wind wing winter wolf wood wren yellow zebra zinc".split(
      " "
    );
}
