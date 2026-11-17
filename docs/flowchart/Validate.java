import javax.xml.parsers.SAXParser;
import javax.xml.parsers.SAXParserFactory;
import org.xml.sax.SAXException;
import org.xml.sax.SAXParseException;
import org.xml.sax.helpers.DefaultHandler;
import java.io.File;

public class Validate {
  public static void main(String[] a) throws Exception {
    SAXParserFactory f = SAXParserFactory.newInstance();
    f.setValidating(false);
    SAXParser p = f.newSAXParser();
    p.parse(new File(a[0]), new DefaultHandler() {
      public void error(SAXParseException e) throws SAXException {
        System.out.println("ERROR line=" + e.getLineNumber() + " col=" + e.getColumnNumber() + " " + e.getMessage());
      }
      public void fatalError(SAXParseException e) throws SAXException {
        System.out.println("FATAL line=" + e.getLineNumber() + " col=" + e.getColumnNumber() + " " + e.getMessage());
        throw e;
      }
      public void warning(SAXParseException e) {
        System.out.println("WARN line=" + e.getLineNumber() + " " + e.getMessage());
      }
    });
    System.out.println("PARSE OK");
  }
}
