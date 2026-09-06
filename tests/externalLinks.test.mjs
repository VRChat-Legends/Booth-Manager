import test from "node:test";
import assert from "node:assert/strict";
import { safeExternalUrl } from "../electron/externalLinks.js";

const repository = "https://vrchatlegends.com/vpm/index.json";
const vccLink = (repo = repository) => `vcc://vpm/addRepo?url=${encodeURIComponent(repo)}`;

const webLinks = [
  ["https://vrchatlegends.com", "https://vrchatlegends.com/"],
  ["http://example.test", "http://example.test/"],
  [" HTTP://EXAMPLE.TEST:80/chat ", "http://example.test/chat"],
  [" HTTPS://EXAMPLE.TEST:443/old/../chat?room=one#latest ", "https://example.test/chat?room=one#latest"],
  ["https://example.test:8443/chat", "https://example.test:8443/chat"],
  ["http://localhost:5175/chat", "http://localhost:5175/chat"],
  ["https://[2001:db8::1]:443/chat", "https://[2001:db8::1]/chat"],
  ["https://b\u00fccher.example/chat", "https://xn--bcher-kva.example/chat"],
  ["https://example.test/chat room", "https://example.test/chat%20room"],
  ["https://example.test/one%2Ftwo?q=a%26b#reply", "https://example.test/one%2Ftwo?q=a%26b#reply"],
  ["https://example.test/%7Echat", "https://example.test/%7Echat"],
  ["https://example.test/@help?email=user@example.test#@reply", "https://example.test/@help?email=user@example.test#@reply"],
  ["https://example.test/?label=Team+Chat&body=100%25", "https://example.test/?label=Team+Chat&body=100%25"]
];

for (const [input, expected] of webLinks) {
  test(`HTTP links normalize safely without losing data: ${input}`, () => {
    assert.equal(safeExternalUrl(input), expected);
    assert.equal(safeExternalUrl(expected), expected);
  });
}

test("only primitive strings are accepted without coercing caller objects", () => {
  let coercions = 0;
  const hostile = { toString() { coercions += 1; throw new Error("must not coerce"); } };
  for (const value of [
    undefined, null, true, false, 0, 42, NaN, 1n, Symbol("url"), [], [repository], {}, hostile,
    new String(repository), new URL(repository), () => repository
  ]) {
    assert.equal(safeExternalUrl(value), "");
  }
  assert.equal(coercions, 0);
});

const malformedWebLinks = [
  "", "   ", "not a URL", "example.test", "/chat", "//example.test/chat",
  "https:example.test", "https:/example.test", "https://", "http://",
  "https:///example.test", "https:////example.test", "https://?chat", "https://#chat",
  "https://:443/chat", "https://exa mple.test/", "https://[::1", "https://[invalid]/",
  "https://example.test:65536/", "https://example.test:port/", "https://%zz.test/", "https://%/"
];

for (const input of malformedWebLinks) {
  test(`malformed web links are rejected: ${JSON.stringify(input)}`, () => {
    assert.equal(safeExternalUrl(input), "");
  });
}

for (const input of [
  "https://user:password@example.test/", "http://user@example.test/",
  "https://user:@example.test/", "https://:password@example.test/",
  "https://@example.test/", "https://:@example.test/",
  "https://us%65r:p%40ss@example.test/", "https://user%40example.test@other.test/",
  "https://vrchatlegends.com@other.test/", "https://other.test@vrchatlegends.com/",
  "https://%40example.test/"
]) {
  test(`web credentials and authority tricks are rejected: ${input}`, () => {
    assert.equal(safeExternalUrl(input), "");
  });
}

test("unapproved protocols cannot escape to the operating system", () => {
  for (const input of [
    "data:text/html,hello", "data:text/plain;base64,aGk=", "file:///C:/chat.html",
    "FILE://server/share/chat.html", "javascript:void(0)", "JaVaScRiPt:alert(1)",
    "booth-local://asset/image.png", "BOOTH-LOCAL://chat", "about:blank",
    "blob:https://example.test/id", "ftp://example.test/file", "ws://example.test/",
    "wss://example.test/", "chrome://settings", "shell:AppsFolder", "tel:12345",
    "discord://chat", "ms-settings:display", "vcc://vpm/open"
  ]) {
    assert.equal(safeExternalUrl(input), "", input);
  }
});

test("raw control characters are rejected before trimming or URL parsing", () => {
  const codes = [
    ...Array.from({ length: 32 }, (_, index) => index),
    ...Array.from({ length: 33 }, (_, index) => 0x7f + index)
  ];
  for (const code of codes) {
    const control = String.fromCharCode(code);
    for (const input of [
      `${control}https://example.test/`, `https://example.test/${control}`,
      `https://exam${control}ple.test/`, `https://example.test/?text=${control}`,
      `mailto:help@example.test?subject=Hi${control}there`, `${vccLink()}${control}`
    ]) {
      assert.equal(safeExternalUrl(input), "", JSON.stringify(input));
    }
  }
});

test("encoded ASCII controls are rejected in paths queries fragments and mail headers", () => {
  const codes = [...Array.from({ length: 32 }, (_, index) => index), 0x7f];
  for (const code of codes) {
    const hex = code.toString(16).padStart(2, "0");
    for (const encoded of [`%${hex}`, `%${hex.toUpperCase()}`]) {
      for (const input of [
        `https://example.test/${encoded}chat`, `https://example.test/?text=${encoded}`,
        `https://example.test/#${encoded}`, `mailto:help@example.test?subject=${encoded}`,
        `mailto:help@example.test?body=${encoded}`, `${vccLink()}${encoded}`
      ]) {
        assert.equal(safeExternalUrl(input), "", input);
      }
    }
  }
});

for (const encoded of ["%C2%80", "%c2%85", "%C2%9F"]) {
  test(`encoded C1 controls are rejected in web links: ${encoded}`, () => {
    assert.equal(safeExternalUrl(`https://example.test/${encoded}`), "");
    assert.equal(safeExternalUrl(`https://example.test/?text=${encoded}`), "");
  });
}

test("literal backslashes are never normalized into allowed links", () => {
  for (const input of [
    "https:\\example.test", "https:\\\\example.test/chat", "https://example.test\\@other.test/",
    "https://example.test/chat\\room", "https://example.test/?text=one\\two",
    "C:\\chat.html", "\\\\server\\chat.html", "mailto:help@example.test?body=one\\two",
    "vcc://vpm\\addRepo?url=https://vrchatlegends.com/vpm/index.json"
  ]) {
    assert.equal(safeExternalUrl(input), "", input);
  }
});

const mailLinks = [
  ["mailto:help@vrchatlegends.com", "mailto:help@vrchatlegends.com"],
  ["mailto:Help.Desk+booth@EXAMPLE.TEST?subject=Team%20Chat&body=Please%20help%21", "mailto:Help.Desk+booth@EXAMPLE.TEST?subject=Team%20Chat&body=Please%20help%21"],
  ["mailto:first@example.test,second@example.test?subject=Hello", "mailto:first@example.test,second@example.test?subject=Hello"],
  ["mailto:first%40example.test%2Csecond%40example.test?body=Hi%20team", "mailto:first%40example.test%2Csecond%40example.test?body=Hi%20team"],
  [" MAILTO:help@example.test?SUBJECT=Hello&BODY=Thanks ", "mailto:help@example.test?SUBJECT=Hello&BODY=Thanks"],
  ["mailto:help@support.example.test?subject=&body=", "mailto:help@support.example.test?subject=&body="],
  ["mailto:help@example.test?body=caf%C3%A9%20%2B%20tea", "mailto:help@example.test?body=caf%C3%A9%20%2B%20tea"],
  ["mailto:help@example.test?subject=Fish%20%26%20Chips&body=Use%20%23chat%3B%20thanks%3Dyes", "mailto:help@example.test?subject=Fish%20%26%20Chips&body=Use%20%23chat%3B%20thanks%3Dyes"],
  ["mailto:help@example.test?subject=Hello%26bcc%3Djust%20text", "mailto:help@example.test?subject=Hello%26bcc%3Djust%20text"]
];

for (const [input, expected] of mailLinks) {
  test(`conservative mail links preserve recipients and allowed header data: ${input}`, () => {
    assert.equal(safeExternalUrl(input), expected);
    assert.equal(safeExternalUrl(expected), expected);
  });
}

for (const input of [
  "mailto:", "mailto:?subject=Hello", "mailto:help", "mailto:@example.test", "mailto:help@",
  "mailto:help@@example.test", "mailto:help@example.test,", "mailto:,help@example.test",
  "mailto:help@example.test,,other@example.test", "mailto:help@example.test;other@example.test",
  "mailto:Help%20Desk%20%3Chelp%40example.test%3E", "mailto:%22help%20desk%22@example.test",
  "mailto:help%20desk@example.test", "mailto:help@example_test", "mailto:help@-example.test",
  "mailto:help@example.test-", "mailto:help@.example.test", "mailto:help@example.test.",
  "mailto:help@[127.0.0.1]", "mailto:help@example.test#body", "mailto:help@b\u00fccher.example",
  "mailto:help%ZZ@example.test", "mailto:help%C3%28@example.test"
]) {
  test(`malformed mail recipients are rejected: ${input}`, () => {
    assert.equal(safeExternalUrl(input), "");
  });
}

for (const input of [
  "mailto:.help@example.test", "mailto:help.@example.test", "mailto:help..desk@example.test",
  "mailto:help@example..test", "mailto:help@example-.test", "mailto:help@example.-test",
  "mailto:help@example.-support.test", "mailto:help@example.support-.test"
]) {
  test(`mail dot atoms and domain labels must be well formed: ${input}`, () => {
    assert.equal(safeExternalUrl(input), "");
  });
}

for (const input of [
  "mailto://other.test/help@example.test", "mailto:///help@example.test",
  "mailto://user:password@other.test/help@example.test", "mailto://other.test:443/help@example.test"
]) {
  test(`mail links cannot carry a URL authority: ${input}`, () => {
    assert.equal(safeExternalUrl(input), "");
  });
}

test("mail links allow subject and body only even when header names are encoded", () => {
  for (const header of [
    "to", "cc", "BCC", "from", "sender", "reply-to", "in-reply-to", "content-type",
    "attach", "attachment", "x-header", "url", "subject[]", "body[0]", ""
  ]) {
    const input = `mailto:help@example.test?subject=Hello&${encodeURIComponent(header)}=value`;
    assert.equal(safeExternalUrl(input), "", input);
  }
  for (const query of [
    "%62cc=other%40example.test", "%43%63=other%40example.test", "subject%00=Hello",
    "subject%0d%0aBcc=other%40example.test", "subject=Hello&%61ttach=file%3A%2F%2F%2Fsecret"
  ]) {
    assert.equal(safeExternalUrl(`mailto:help@example.test?${query}`), "", query);
  }
});

test("mail header injection is rejected after percent decoding too", () => {
  for (const content of [
    "Hi\r\nBcc:other@example.test", "Hi\nCc:other@example.test", "Hi\rFrom:other@example.test",
    "Hi\u0000there", "Hi\u007fthere", "Hi\u0080there", "Hi\u0085Bcc:other@example.test", "Hi\u009fthere"
  ]) {
    for (const header of ["subject", "body", "SUBJECT", "BODY"]) {
      const input = `mailto:help@example.test?${header}=${encodeURIComponent(content)}`;
      assert.equal(safeExternalUrl(input), "", input);
    }
  }
  assert.equal(safeExternalUrl("mailto:help@example.test%0D%0ABcc:other@example.test"), "");
});

test("VCC accepts one trusted repository while preserving the deep link", () => {
  const link = vccLink();
  assert.equal(safeExternalUrl(link), link);
  assert.equal(safeExternalUrl(` VCC://vpm/addRepo?url=${encodeURIComponent(repository)} `), link);
  assert.equal(safeExternalUrl(`vcc://vpm/old/../addRepo?url=${encodeURIComponent(repository)}`), link);
  const plain = `vcc://vpm/addRepo?url=${repository}`;
  assert.equal(safeExternalUrl(plain), plain);
});

test("VCC preserves nested escaping query separators and normalized trusted origins", () => {
  const repo = "HTTPS://VRCHATLEGENDS.COM:443/vpm/../vpm/index.json?channel=stable&label=Team+Chat&path=%2Fchat#packages";
  const link = vccLink(repo);
  const safe = safeExternalUrl(link);
  assert.equal(safe, link);
  assert.equal(safeExternalUrl(safe), safe);
  const parsed = new URL(safe);
  assert.equal(parsed.protocol, "vcc:");
  assert.equal(parsed.hostname, "vpm");
  assert.equal(parsed.pathname, "/addRepo");
  assert.equal(parsed.hash, "");
  assert.deepEqual([...parsed.searchParams.keys()], ["url"]);
  assert.deepEqual(parsed.searchParams.getAll("url"), [repo]);
  assert.equal(new URL(parsed.searchParams.get("url")).origin, "https://vrchatlegends.com");
});

test("VCC requires exactly one repository argument and no unrelated options", () => {
  const encoded = encodeURIComponent(repository);
  for (const suffix of [
    "", "?", "?url=", "?url", `?URL=${encoded}`, `?Url=${encoded}`, `?repo=${encoded}`,
    `?url=${encoded}&url=${encoded}`, `?url=${encoded}&url=`, `?url=&url=${encoded}`,
    `?u%72l=${encoded}&url=${encoded}`, `?url=${encoded}&name=Other`,
    `?url=${encoded}&force=true`, `?url=${encoded}&=value`, `?url=${encoded}#other`
  ]) {
    const input = `vcc://vpm/addRepo${suffix}`;
    assert.equal(safeExternalUrl(input), "", input);
  }
});

test("VCC rejects other handlers routes credentials and spoofed outer hosts", () => {
  const query = `?url=${encodeURIComponent(repository)}`;
  for (const base of [
    "vcc:vpm/addRepo", "vcc:/vpm/addRepo", "vcc://vpm", "vcc://vpm/addrepo",
    "vcc://vpm/AddRepo", "vcc://vpm/addRepo/", "vcc://vpm/addRepo/other", "vcc://vpm/open",
    "vcc://other.test/addRepo", "vcc://vpm.other.test/addRepo", "vcc://vpm./addRepo",
    "vcc://vpm@other.test/addRepo", "vcc://other.test@vpm/addRepo",
    "vcc://user:password@vpm/addRepo", "vcc://:password@vpm/addRepo",
    "vcc://vpm%2Eother.test/addRepo"
  ]) {
    assert.equal(safeExternalUrl(`${base}${query}`), "", base);
  }
});

for (const authority of ["vpm:443", "vpm:8443", "@vpm", ":@vpm"]) {
  test(`VCC requires a bare vpm authority: ${authority}`, () => {
    const input = `vcc://${authority}/addRepo?url=${encodeURIComponent(repository)}`;
    assert.equal(safeExternalUrl(input), "");
  });
}

for (const repo of [
  "http://vrchatlegends.com/vpm/index.json", "https://www.vrchatlegends.com/vpm/index.json",
  "https://sub.vrchatlegends.com/vpm/index.json", "https://vrchatlegends.com:444/vpm/index.json",
  "https://vrchatlegends.com./vpm/index.json", "https://vrchatlegends.com.other.test/vpm/index.json",
  "https://vrchatlegends.com%2Eother.test/vpm/index.json", "https://vrchatlegends-com.test/vpm/index.json",
  "https://other.test/https://vrchatlegends.com/vpm/index.json",
  "https://other.test/?repo=https://vrchatlegends.com", "https://other.test/#https://vrchatlegends.com",
  "https://vrchatlegends.com@other.test/vpm/index.json", "https://other.test@vrchatlegends.com/vpm/index.json",
  "https://user:password@vrchatlegends.com/vpm/index.json", "https://:password@vrchatlegends.com/vpm/index.json",
  "https://vrch\u0430tlegends.com/vpm/index.json", "https://127.0.0.1/vpm/index.json",
  "https://[::1]/vpm/index.json", "//vrchatlegends.com/vpm/index.json", "/vpm/index.json",
  "not a URL", "https://", "file:///C:/index.json", "data:application/json,{}",
  "javascript:void(0)", "booth-local://repo/index.json", "ftp://vrchatlegends.com/index.json"
]) {
  test(`VCC rejects an untrusted or malformed repository: ${repo}`, () => {
    assert.equal(safeExternalUrl(vccLink(repo)), "");
  });
}

test("VCC does not treat a doubly encoded repository scheme as a valid URL", () => {
  assert.equal(safeExternalUrl(vccLink(encodeURIComponent(repository))), "");
});

for (const repo of [
  "https://@vrchatlegends.com/vpm/index.json", "https://:@vrchatlegends.com/vpm/index.json",
  "https://vrchatlegends.com\\vpm\\index.json", "https:vrchatlegends.com/vpm/index.json",
  "https:/vrchatlegends.com/vpm/index.json", "https:///vrchatlegends.com/vpm/index.json"
]) {
  test(`VCC applies strict web validation to its decoded repository: ${repo}`, () => {
    assert.equal(safeExternalUrl(vccLink(repo)), "");
  });
}

for (const encoded of ["%00", "%0D%0A", "%1f", "%7F", "%C2%85"]) {
  test(`VCC rejects controls inside an encoded repository URL: ${encoded}`, () => {
    const repo = `${repository}?text=${encoded}other`;
    assert.equal(safeExternalUrl(vccLink(repo)), "");
  });
}