package com.vaultriad.app;

import android.content.Context;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;

public final class VaultFiles {

  private final File directory;
  private final AtomicFile current, previous;

  public VaultFiles(Context context) {
    directory = context.getFilesDir();
    current = new AtomicFile(new File(directory, "vault.vtriad"));
    previous = new AtomicFile(new File(directory, "vault.vtriad.previous"));
  }

  public boolean exists() {
    return current.getBaseFile().exists();
  }

  public String read() throws IOException {
    try (InputStream in = current.openRead()) {
      return readLimited(in);
    }
  }

  public String readPrevious() throws IOException {
    try (InputStream in = previous.openRead()) {
      return readLimited(in);
    }
  }

  public synchronized void write(String raw) throws IOException {
    if (exists()) writeAtomic(previous, read());
    writeAtomic(current, raw);
  }

  private static void writeAtomic(
    AtomicFile file,
    String raw
  ) throws IOException {
    FileOutputStream stream = null;
    try {
      stream = file.startWrite();
      stream.write(raw.getBytes(StandardCharsets.UTF_8));
      file.finishWrite(stream);
    } catch (IOException e) {
      if (stream != null) file.failWrite(stream);
      throw e;
    }
  }

  public void resetAfterBackup() {
    current.delete();
    previous.delete();
  }

  public static String readLimited(InputStream input) throws IOException {
    if (input == null) throw new IOException("No input stream");
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int n;
    while ((n = input.read(buffer)) != -1) {
      if (bytes.size() + n > VaultCrypto.MAX_BYTES) throw new IOException(
        "File exceeds the mobile size limit"
      );
      bytes.write(buffer, 0, n);
    }
    return bytes.toString(StandardCharsets.UTF_8.name());
  }

  public File biometricFile() {
    return new File(directory, "biometric.os");
  }

  public static void writeBiometric(File file, String raw) throws IOException {
    writeAtomic(new AtomicFile(file), raw);
  }
}
