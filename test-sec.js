import { fetchFilingText } from "./js/sec.js";
global.localStorage = { getItem: () => null, setItem: () => {} };
const test = async (html, expected) => {
  global.fetch = async () => ({
    ok: true,
    text: async () => html
  });
  try {
    const result = await fetchFilingText({ textUrl: "http://example.com" });
    const passed = result === expected;
    console.log(JSON.stringify({ html, expected, actual: result, passed }));
  } catch (e) {
    console.log(JSON.stringify({ html, expected, error: e.stack }));
  }
};
const run = async () => {
  await test("<p>One<br>Two</p><div>&#8220;Company&#8221; &amp; Co.</div>", "One\nTwo\n“Company” & Co.");
  await test("&lt;div&gt;Intro&lt;br&gt;Line&lt;/p&gt;&lt;ix:nonNumeric&gt;&#8220;Company&#8221; &amp; Co.&lt;/ix:nonNumeric&gt;&lt;/div&gt;", "Intro\nLine\n“Company” & Co.");
};
run();
