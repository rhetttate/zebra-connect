import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeGfa, buildLabelZpl, buildTestZpl, setZplModeCommand } from '../src/zpl.js';

const bitmap = {
  width: 16,
  height: 2,
  bytesPerRow: 2,
  data: new Uint8Array([0xff, 0x00, 0x0f, 0xf0]),
};

test('encodeGfa emits totals, bytes-per-row, and uppercase hex', () => {
  assert.equal(encodeGfa(bitmap), '^GFA,4,4,2,FF000FF0');
});

test('buildLabelZpl composes a bitmap-only job', () => {
  const zpl = buildLabelZpl({ width: 576, height: 406, bitmap, quantity: 3, darkness: 20 });
  assert.ok(zpl.startsWith('~SD20
^XA'));
  assert.ok(zpl.includes('^PW576'));
  assert.ok(zpl.includes('^LL406'));
  assert.ok(zpl.includes('^FO0,0^GFA,4,4,2,FF000FF0^FS'));
  assert.ok(!zpl.includes('^BU'), 'barcodes are drawn into the bitmap, never a native field');
  assert.ok(zpl.includes('^PQ3'));
  assert.ok(zpl.trimEnd().endsWith('^XZ'));
});

test('buildLabelZpl omits darkness when absent and defaults quantity to 1', () => {
  const zpl = buildLabelZpl({ width: 576, height: 406, bitmap });
  assert.ok(zpl.startsWith('^XA'));
  assert.ok(!zpl.includes('~SD'));
  assert.ok(zpl.includes('^PQ1'));
});

test('buildTestZpl and setZplModeCommand return fixed commands', () => {
  assert.ok(buildTestZpl().startsWith('^XA'));
  assert.ok(buildTestZpl().includes('Zebra Connect'));
  assert.equal(setZplModeCommand(), '! U1 setvar "device.languages" "hybrid_xml_zpl"\r\n');
});

test('buildCalibrationZpl sets media tracking and calibrates', async () => {
  const { buildCalibrationZpl } = await import('../src/zpl.js');
  assert.equal(buildCalibrationZpl('gap'), '^XA^MNY^JUS^XZ\n~JC\n');
  assert.equal(buildCalibrationZpl('mark'), '^XA^MNM^JUS^XZ\n~JC\n');
  // continuous has nothing to sense: set the mode, skip the calibration feed
  assert.equal(buildCalibrationZpl('continuous'), '^XA^MNN^JUS^XZ\n');
  assert.throws(() => buildCalibrationZpl('sideways'), /media type/);
});
