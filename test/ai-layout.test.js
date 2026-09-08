import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutDraft, ROLE_ORDER } from '../src/ai-layout.js';
import { SIZES, defaultLayout } from '../src/layout.js';

const content = (over = {}) => ({
  name: 'Almond Flour',
  description: 'Blanched, finely ground.',
  ingredients: '',
  extras: [],
  ...over,
});

const sixExtras = [
  { role: 'lot', text: 'Lot 42' },
  { role: 'best_by', text: 'Best by Oct 15, 2026' },
  { role: 'packed_on', text: 'Packed Sep 8, 2026' },
  { role: 'allergens', text: 'Contains: tree nuts' },
  { role: 'net', text: 'Net wt 2 lb (907 g)' },
  { role: 'note', text: 'Keep refrigerated' },
];

function inside(box, size) {
  const { width, height } = SIZES[size];
  return box.x >= 0 && box.y >= 0 && box.w > 0 && box.h >= 0
    && box.x + box.w <= width && box.y + box.h <= height;
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// Every box that prints: name, barcode, extras, and the description when shown.
function visibleBoxes(draft) {
  const boxes = [
    { key: 'name', ...draft.layout.name },
    { key: 'barcode', ...draft.layout.barcode },
    ...draft.extras.map((e) => ({ key: e.role, ...e.box })),
  ];
  if (draft.options.showDescription) boxes.push({ key: 'description', ...draft.layout.description });
  return boxes;
}

function assertClean(draft) {
  const boxes = visibleBoxes(draft);
  for (const b of boxes) assert.ok(inside(b, draft.size), `${b.key} outside ${draft.size}: ${JSON.stringify(b)}`);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      assert.ok(!overlaps(boxes[i], boxes[j]), `${boxes[i].key} overlaps ${boxes[j].key} on ${draft.size}`);
    }
  }
}

test('5x3 without ingredients: description takes the body, no extras', () => {
  const draft = layoutDraft({ size: '3x5', content: content() });
  assert.equal(draft.size, '3x5');
  assert.equal(draft.fields.name, 'Almond Flour');
  assert.equal(draft.fields.barcode, '');
  assert.equal(draft.options.showDescription, true);
  assert.deepEqual(draft.extras, []);
  assert.deepEqual(draft.layout.barcode, { ...defaultLayout('3x5').barcode });
  assert.equal(draft.layout.name.h, 100);
  assert.ok(draft.layout.description.h > 300, 'description fills the body');
  assertClean(draft);
});

test('5x3 with ingredients: one-line description, extras band, ingredients body', () => {
  const draft = layoutDraft({ size: '3x5', content: content({
    ingredients: 'Blanched almonds.',
    extras: sixExtras.slice(0, 3),
  }) });
  assert.equal(draft.options.showDescription, true);
  assert.equal(draft.layout.description.h, 60);
  assert.equal(draft.layout.description.y, 130);
  const band = draft.extras.filter((e) => e.role !== 'ingredients');
  assert.deepEqual(band.map((e) => e.role), ['lot', 'best_by', 'packed_on']);
  assert.equal(band[0].box.y, band[1].box.y, 'two per row');
  assert.ok(band[2].box.y > band[0].box.y, 'third wraps to a new row');
  for (const e of band) {
    assert.equal(e.fit, true);
    assert.equal(e.align, 'L');
    assert.equal(e.rotation, 0);
    assert.match(e.id, /^[0-9a-f-]{36}$/);
  }
  const ing = draft.extras.find((e) => e.role === 'ingredients');
  assert.equal(ing.text, 'Ingredients: Blanched almonds.');
  assert.equal(ing.align, 'L');
  assert.equal(ing.fit, undefined, 'ingredients wrap rather than fit one line');
  assert.ok(ing.box.h >= 60);
  assert.equal(ing.box.x + ing.box.w <= draft.layout.barcode.x, true);
  assertClean(draft);
});

// The band has to be genuinely too tall for a description line plus a 60-dot
// ingredients body: seven extras, three of them long enough to wrap.
const crowdedExtras = [
  { role: 'lot', text: 'Lot 42' },
  { role: 'best_by', text: 'Best by Oct 15, 2026' },
  { role: 'packed_on', text: 'Packed Sep 8, 2026' },
  { role: 'allergens', text: 'Contains: wheat, milk, soy, egg. Manufactured on equipment that also processes peanuts and tree nuts.' },
  { role: 'net', text: 'Net wt 2 lb (907 g)' },
  { role: 'note', text: 'Keep refrigerated until the seal is broken, then use within 5 days.' },
  { role: 'note', text: 'Certified organic by a third-party inspector; see the store binder.' },
];

test('5x3 drops the description line before squeezing ingredients', () => {
  const draft = layoutDraft({ size: '3x5', content: content({
    ingredients: 'Blanched almonds.',
    extras: crowdedExtras,
  }) });
  assert.equal(draft.options.showDescription, false);
  const ing = draft.extras.find((e) => e.role === 'ingredients');
  assert.ok(ing, 'ingredients still placed');
  assert.ok(ing.box.h >= 60);
  assertClean(draft);
});


test('extras are sorted by role, unknown roles and blank text dropped', () => {
  const draft = layoutDraft({ size: '3x5', content: content({ extras: [
    { role: 'note', text: 'Keep cold' },
    { role: 'bogus', text: 'x' },
    { role: 'lot', text: '   ' },
    { role: 'best_by', text: 'Best by Oct 15, 2026' },
    { role: 'lot', text: 'Lot 7' },
  ] }) });
  assert.deepEqual(draft.extras.map((e) => e.role), ['lot', 'best_by', 'note']);
  assert.equal(draft.extras[0].text, 'Lot 7');
});

test('3x2 keeps only the extras that fit and hides the description when squeezed', () => {
  const draft = layoutDraft({ size: '3x2', content: content({ extras: sixExtras.slice(0, 3) }) });
  assert.equal(draft.extras.length, 2);
  assert.deepEqual(draft.extras.map((e) => e.role), ['lot', 'best_by']);
  assert.equal(draft.options.showDescription, false);
  assert.equal(draft.layout.barcode.h, 130);
  assert.equal(draft.layout.barcode.y + draft.layout.barcode.h, 406 - 20);
  assertClean(draft);

  const roomy = layoutDraft({ size: '3x2', content: content({ extras: sixExtras.slice(0, 1) }) });
  assert.equal(roomy.options.showDescription, true);
  assertClean(roomy);
});

test('2x1.25 fits one extra and ignores ingredients', () => {
  const draft = layoutDraft({ size: '2x1.25', content: content({
    ingredients: 'Almonds.',
    extras: sixExtras.slice(0, 2),
  }) });
  assert.equal(draft.extras.length, 1);
  assert.equal(draft.extras[0].role, 'lot');
  assert.ok(!draft.extras.some((e) => e.role === 'ingredients'));
  assert.equal(draft.options.showDescription, false);
  assert.equal(draft.layout.barcode.h, 100);
  assertClean(draft);

  const plain = layoutDraft({ size: '2x1.25', content: content() });
  assert.equal(plain.options.showDescription, true);
  assertClean(plain);
});

test('description is hidden when empty even with room', () => {
  const draft = layoutDraft({ size: '3x5', content: content({ description: '' }) });
  assert.equal(draft.options.showDescription, false);
  assert.ok(draft.layout.description, 'a box still exists so the editor can turn it on');
});

test('every size × extra count × ingredients × description lays out clean', () => {
  for (const size of Object.keys(SIZES)) {
    for (const n of [0, 1, 3, 6]) {
      for (const ingredients of ['', 'Sugar, cocoa butter, whole milk powder, soy lecithin.']) {
        for (const description of ['', 'Dark chocolate bar.']) {
          const draft = layoutDraft({ size, content: content({ ingredients, description, extras: sixExtras.slice(0, n) }) });
          assertClean(draft);
          const roles = draft.extras.filter((e) => e.role !== 'ingredients').map((e) => ROLE_ORDER.indexOf(e.role));
          assert.deepEqual(roles, [...roles].sort((a, b) => a - b), `role order on ${size}`);
        }
      }
    }
  }
});

test('unknown size throws', () => {
  assert.throws(() => layoutDraft({ size: '9x9', content: content() }), /unknown size/);
});

test('band extras share one text size cap, set by the longest short line', () => {
  const draft = layoutDraft({ size: '3x5', content: content({ extras: [
    { role: 'lot', text: 'Lot 42' },
    { role: 'best_by', text: 'Best by Oct 15, 2026' },
  ] }) });
  const [lot, best] = draft.extras;
  assert.equal(lot.textSize, best.textSize);
  // Half column is 300 wide; 20 chars at 0.55 em each -> floor(300 / 11) = 27.
  assert.equal(best.textSize, 27);
  assert.equal(lot.box.w, 300);
  assert.equal(best.box.w, 300);
  // Rows shrink to the text: min(70, round(27 * 1.5)) = 41.
  assert.equal(lot.box.h, 41);
  assert.equal(best.box.h, 41);
});

test('a long extra takes a full-width wrapped row on 5x3', () => {
  const draft = layoutDraft({ size: '3x5', content: content({ extras: [
    { role: 'lot', text: 'Lot 42' },
    { role: 'best_by', text: 'Best by Oct 15, 2026' },
    { role: 'allergens', text: 'Contains: soy. May contain: milk, tree nuts' },
    { role: 'net', text: 'Net wt 3 oz (85 g)' },
  ] }) });
  const [lot, best, allergens, net] = draft.extras;
  assert.equal(lot.box.y, best.box.y, 'two short extras share a row');
  assert.equal(allergens.box.w, 610, 'the long line spans the body');
  assert.ok(allergens.box.y > lot.box.y);
  assert.ok(net.box.y > allergens.box.y, 'the next short extra starts a fresh row');
  assert.equal(net.box.x, 20);
  // The long line wraps at the shared band size instead of dragging it down.
  assert.equal(allergens.fit, undefined, 'wrapped, not fitted to one line');
  assert.equal(allergens.align, 'L');
  assert.equal(allergens.textSize, lot.textSize);
  assert.equal(allergens.box.h, Math.round(27 * 1.15 * 2 + 27 * 0.4), 'two lines at the band size plus padding');
  const sizes = new Set(draft.extras.map((e) => e.textSize));
  assert.equal(sizes.size, 1, 'one size across the band');
  assertClean(draft);
});

test('a long line on 5x3 does not shrink the short extras, and ingredients get a cap', () => {
  const draft = layoutDraft({ size: '3x5', content: content({
    ingredients: 'Blanched almonds, sea salt.',
    extras: [
      { role: 'lot', text: 'Lot 42' },
      { role: 'best_by', text: 'Best by Oct 15, 2026' },
      { role: 'allergens', text: 'Contains: wheat, milk, soy, egg. Manufactured on equipment that also processes peanuts and tree nuts.' },
    ],
  }) });
  const lot = draft.extras.find((e) => e.role === 'lot');
  const allergens = draft.extras.find((e) => e.role === 'allergens');
  const ing = draft.extras.find((e) => e.role === 'ingredients');
  assert.ok(lot.textSize >= 22, `short extras keep a readable size, got ${lot.textSize}`);
  assert.equal(allergens.fit, undefined, 'the 100-char line wraps');
  assert.equal(allergens.textSize, lot.textSize);
  assert.ok(ing.textSize >= 28, `ingredients are capped, got ${ing.textSize}`);
  assert.ok(ing.box.h >= 60);
  assertClean(draft);
});

test('small sizes cap band text too, and wrap their long lines', () => {
  const small = layoutDraft({ size: '3x2', content: content({ extras: [{ role: 'lot', text: 'Lot 9' }] }) });
  // Row height 50 -> cap is 40; "Lot 9" would fit far larger.
  assert.equal(small.extras[0].textSize, 40);
  assert.equal(small.extras[0].box.h, 50, 'min(50, round(40 * 1.5)) = 50');

  const wrapped = layoutDraft({ size: '3x2', content: content({ extras: [
    { role: 'allergens', text: 'Contains: wheat, milk, soy, egg. Manufactured on equipment that also processes peanuts and tree nuts.' },
  ] }) });
  const long = wrapped.extras[0];
  assert.equal(long.role, 'allergens');
  assert.equal(long.fit, undefined, 'the long line wraps on the small sizes too');
  assert.equal(long.textSize, 40, 'no short extra, so the size stays at the row cap');
  assert.equal(long.box.h, Math.round(40 * 1.15 * 2 + 40 * 0.4));
  assertClean(wrapped);

  // A long line that will not fit under a short one is dropped, not squeezed:
  // a 3x2 band has 140 dots between the name and the barcode, and a 50-dot row
  // plus a 108-dot wrapped row does not fit.
  const both = layoutDraft({ size: '3x2', content: content({ extras: [
    { role: 'lot', text: 'Lot 9' },
    { role: 'allergens', text: 'Contains: wheat, milk, soy, egg. Manufactured on equipment that also processes peanuts and tree nuts.' },
  ] }) });
  assert.deepEqual(both.extras.map((e) => e.role), ['lot']);
  assert.equal(both.extras[0].textSize, 40, 'the dropped long line never pulled the cap down');
  assertClean(both);
});

// Mixed line lengths, including the real allergen line from a store label.
const L5 = 'Lot 9';
const L24 = 'Best by Oct 15, 2026 GMT';
const L40 = 'Contains: milk, soy, wheat and tree nuts';
const L103 = 'Contains: wheat, milk, soy, egg. Manufactured on equipment that also processes peanuts and tree nuts.';
const ROLE_POOL = ['lot', 'best_by', 'packed_on', 'allergens', 'net', 'note', 'note'];

test('mixed line lengths: every size x 0..7 extras x ingredients x description stays on the label', () => {
  const texts = [L5, L24, L40, L103];
  assert.deepEqual(texts.map((t) => t.length), [5, 24, 40, 101]);
  for (const size of Object.keys(SIZES)) {
    const { height } = SIZES[size];
    for (let n = 0; n <= 7; n++) {
      for (let shift = 0; shift < texts.length; shift++) {
        const extras = ROLE_POOL.slice(0, n).map((role, i) => ({ role, text: texts[(i + shift) % texts.length] }));
        for (const ingredients of ['', 'Sugar, cocoa butter, whole milk powder, soy lecithin.']) {
          for (const description of ['', 'Dark chocolate bar.']) {
            const where = `${size} n=${n} shift=${shift} ing=${ingredients ? 'y' : 'n'} desc=${description ? 'y' : 'n'}`;
            const draft = layoutDraft({ size, content: content({ ingredients, description, extras }) });
            assertClean(draft);
            for (const e of draft.extras) {
              assert.ok(e.box.y + e.box.h <= height, `${e.role} runs off the label - ${where}`);
            }
            if (size === '3x5' && ingredients) {
              const ing = draft.extras.find((e) => e.role === 'ingredients');
              assert.ok(ing, `ingredients dropped - ${where}`);
              assert.ok(ing.box.h >= 60, `ingredients squeezed to ${ing.box.h} - ${where}`);
            }
          }
        }
      }
    }
  }
});
