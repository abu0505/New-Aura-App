const phrases = [
  "me abhi ye auto complete wala feature test karunga",
  "me feature testing kar raha hun",
  "feature tested"
];

const text = "bhai me abhi";

let bestSuggestion = null;
let longestMatchLen = 0;

for (const phrase of phrases) {
  const lowerPhrase = phrase.toLowerCase();
  
  for (let i = 0; i < text.length; i++) {
    if (i === 0 || /\\W/.test(text[i - 1])) {
      const suffix = text.slice(i);
      console.log(`Checking suffix: "${suffix}" against "${lowerPhrase}"`);
      if (suffix.length > 0 && lowerPhrase.startsWith(suffix)) {
        if (lowerPhrase.length > suffix.length) {
          if (suffix.length > longestMatchLen) {
            longestMatchLen = suffix.length;
            bestSuggestion = phrase.slice(suffix.length);
            console.log(`New best match: "${bestSuggestion}" (len: ${longestMatchLen})`);
          }
        }
      }
    }
  }
}

console.log("Final suggestion:", bestSuggestion);
