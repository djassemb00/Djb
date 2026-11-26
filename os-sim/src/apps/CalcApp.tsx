import { useState } from 'react';
import { sfx } from '../system/sound';
import { cx } from '../system/cx';

const KEYS = [
  ['C', 'fn'],
  ['±', 'fn'],
  ['%', 'fn'],
  ['÷', 'op'],
  ['7', ''],
  ['8', ''],
  ['9', ''],
  ['×', 'op'],
  ['4', ''],
  ['5', ''],
  ['6', ''],
  ['−', 'op'],
  ['1', ''],
  ['2', ''],
  ['3', ''],
  ['+', 'op'],
  ['0', ''],
  ['.', ''],
  ['⌫', 'fn'],
  ['=', 'eq'],
] as const;

export function CalcApp() {
  const [display, setDisplay] = useState('0');
  const [acc, setAcc] = useState<number | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [history, setHistory] = useState('');
  const [fresh, setFresh] = useState(true);

  const compute = (a: number, b: number, operator: string) => {
    switch (operator) {
      case '+':
        return a + b;
      case '−':
        return a - b;
      case '×':
        return a * b;
      case '÷':
        return b === 0 ? NaN : a / b;
      default:
        return b;
    }
  };

  const fmt = (n: number) => {
    if (!Number.isFinite(n)) return 'خطأ';
    const s = Math.abs(n) >= 1e12 ? n.toExponential(6) : String(parseFloat(n.toPrecision(12)));
    return s;
  };

  const press = (key: string) => {
    sfx.tap();
    if (/[0-9]/.test(key)) {
      setDisplay((d) => (fresh || d === '0' ? key : d + key));
      setFresh(false);
      return;
    }
    if (key === '.') {
      setDisplay((d) => (fresh ? '0.' : d.includes('.') ? d : d + '.'));
      setFresh(false);
      return;
    }
    if (key === 'C') {
      setDisplay('0');
      setAcc(null);
      setOp(null);
      setHistory('');
      setFresh(true);
      return;
    }
    if (key === '⌫') {
      setDisplay((d) => (d.length <= 1 ? '0' : d.slice(0, -1)));
      return;
    }
    if (key === '±') {
      setDisplay((d) => (d.startsWith('-') ? d.slice(1) : d === '0' ? '0' : `-${d}`));
      return;
    }
    if (key === '%') {
      setDisplay((d) => fmt(parseFloat(d) / 100));
      return;
    }
    if (['+', '−', '×', '÷'].includes(key)) {
      const value = parseFloat(display);
      if (acc !== null && op && !fresh) {
        const res = compute(acc, value, op);
        setAcc(res);
        setDisplay(fmt(res));
      } else {
        setAcc(value);
      }
      setOp(key);
      setHistory(`${fmt(acc ?? value)} ${key}`);
      setFresh(true);
      return;
    }
    if (key === '=') {
      if (acc === null || !op) return;
      const value = parseFloat(display);
      const res = compute(acc, value, op);
      setHistory(`${fmt(acc)} ${op} ${fmt(value)} =`);
      setDisplay(fmt(res));
      setAcc(null);
      setOp(null);
      setFresh(true);
    }
  };

  return (
    <div className="calc">
      <div className="calc-screen">
        <div className="calc-history">{history || '\u00A0'}</div>
        <div className="calc-value">{display}</div>
      </div>
      <div className="calc-grid">
        {KEYS.map(([k, cls]) => (
          <button key={k} className={cx('calc-key', cls)} onClick={() => press(k)}>
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}
