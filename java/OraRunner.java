import java.io.*;
import java.sql.*;
import java.text.SimpleDateFormat;

/**
 * Ponte JDBC simples para o painel.
 * Entrada (stdin, uma por linha): jdbcUrl, user, password, ini(YYYY-MM-DD), fim(YYYY-MM-DD),
 *   e o restante do stream = SQL (com dois '?' -> bind ini, fim).
 * Saida (stdout): array JSON de objetos (coluna -> valor).
 * Erro: mensagem no stderr + exit 1.
 */
public class OraRunner {
  public static void main(String[] args) {
    Connection con = null;
    try {
      BufferedReader br = new BufferedReader(new InputStreamReader(System.in, "UTF-8"));
      String jdbcUrl = br.readLine();
      String user = br.readLine();
      String password = br.readLine();
      String ini = br.readLine();
      String fim = br.readLine();
      StringBuilder sb = new StringBuilder();
      String line;
      while ((line = br.readLine()) != null) sb.append(line).append("\n");
      String sql = sb.toString().trim();

      try { Class.forName("oracle.jdbc.OracleDriver"); } catch (Throwable t) {}

      con = DriverManager.getConnection(jdbcUrl, user, password);
      PreparedStatement ps = con.prepareStatement(sql);
      int nParms = 0;
      for (int i = 0; i < sql.length(); i++) if (sql.charAt(i) == '?') nParms++;
      if (nParms >= 1) ps.setString(1, ini);
      if (nParms >= 2) ps.setString(2, fim);

      ResultSet rs = ps.executeQuery();
      ResultSetMetaData md = rs.getMetaData();
      int n = md.getColumnCount();
      SimpleDateFormat df = new SimpleDateFormat("yyyy-MM-dd");

      StringBuilder out = new StringBuilder();
      out.append("[");
      boolean firstRow = true;
      while (rs.next()) {
        if (!firstRow) out.append(",");
        firstRow = false;
        out.append("{");
        for (int i = 1; i <= n; i++) {
          if (i > 1) out.append(",");
          out.append("\"").append(esc(md.getColumnLabel(i))).append("\":");
          int type = md.getColumnType(i);
          if (type == Types.DATE || type == Types.TIMESTAMP) {
            Timestamp ts = rs.getTimestamp(i);
            if (ts == null) out.append("null");
            else out.append("\"").append(df.format(ts)).append("\"");
          } else if (type == Types.NUMERIC || type == Types.DECIMAL || type == Types.INTEGER
              || type == Types.BIGINT || type == Types.DOUBLE || type == Types.FLOAT
              || type == Types.REAL || type == Types.SMALLINT || type == Types.TINYINT) {
            java.math.BigDecimal bd = rs.getBigDecimal(i);
            out.append(bd == null ? "null" : bd.toPlainString());
          } else {
            String s = rs.getString(i);
            if (s == null) out.append("null");
            else out.append("\"").append(esc(s)).append("\"");
          }
        }
        out.append("}");
      }
      out.append("]");
      rs.close(); ps.close();

      System.out.write(out.toString().getBytes("UTF-8"));
      System.out.flush();
    } catch (Throwable e) {
      System.err.println(e.getClass().getName() + ": " + e.getMessage());
      System.exit(1);
    } finally {
      if (con != null) try { con.close(); } catch (Exception ignore) {}
    }
  }

  static String esc(String s) {
    StringBuilder b = new StringBuilder();
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      if (c == '"' || c == '\\') b.append('\\').append(c);
      else if (c == '\n') b.append("\\n");
      else if (c == '\r') b.append("\\r");
      else if (c == '\t') b.append("\\t");
      else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
      else b.append(c);
    }
    return b.toString();
  }
}
