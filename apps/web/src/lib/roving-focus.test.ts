import { describe, expect, it } from 'vitest';
import { moveInRows, moveInStations } from './roving-focus';

// Three stations: the first with 2 flags, the second empty, the third with 1 (plate = item 0).
const stations = [3, 1, 2];

describe('moveInStations', () => {
  it('moves between stations with Left and Right, to the plate of the next one', () => {
    expect(moveInStations({ group: 0, item: 2 }, 'ArrowRight', stations, false)).toEqual({
      group: 1,
      item: 0,
    });
    expect(moveInStations({ group: 2, item: 1 }, 'ArrowLeft', stations, false)).toEqual({
      group: 1,
      item: 0,
    });
  });

  it('keeps focus in place at either end of the line', () => {
    expect(moveInStations({ group: 2, item: 1 }, 'ArrowRight', stations, false)).toBeNull();
    expect(moveInStations({ group: 0, item: 2 }, 'ArrowLeft', stations, false)).toBeNull();
  });

  it('moves between flags with Up and Down, stopping at the plate and the last flag', () => {
    expect(moveInStations({ group: 0, item: 0 }, 'ArrowDown', stations, false)).toEqual({
      group: 0,
      item: 1,
    });
    expect(moveInStations({ group: 0, item: 2 }, 'ArrowDown', stations, false)).toEqual({
      group: 0,
      item: 2,
    });
    expect(moveInStations({ group: 0, item: 0 }, 'ArrowUp', stations, false)).toEqual({
      group: 0,
      item: 0,
    });
  });

  it('jumps to the first and last station with Home and End', () => {
    expect(moveInStations({ group: 1, item: 0 }, 'Home', stations, false)).toEqual({
      group: 0,
      item: 0,
    });
    expect(moveInStations({ group: 0, item: 1 }, 'End', stations, false)).toEqual({
      group: 2,
      item: 0,
    });
  });

  it('ignores other keys', () => {
    expect(moveInStations({ group: 0, item: 0 }, 'Enter', stations, false)).toBeNull();
  });
});

describe('moveInRows', () => {
  const rows = [5, 5, 5];

  it('keeps the column when moving between rows', () => {
    expect(moveInRows({ group: 0, item: 3 }, 'ArrowDown', rows, false)).toEqual({
      group: 1,
      item: 3,
    });
    expect(moveInRows({ group: 0, item: 3 }, 'ArrowUp', rows, false)).toEqual({
      group: 0,
      item: 3,
    });
  });

  it('goes to the ends of the row, or of the table with Ctrl', () => {
    expect(moveInRows({ group: 1, item: 2 }, 'End', rows, false)).toEqual({ group: 1, item: 4 });
    expect(moveInRows({ group: 1, item: 2 }, 'Home', rows, false)).toEqual({ group: 1, item: 0 });
    expect(moveInRows({ group: 1, item: 2 }, 'End', rows, true)).toEqual({ group: 2, item: 4 });
    expect(moveInRows({ group: 1, item: 2 }, 'Home', rows, true)).toEqual({ group: 0, item: 0 });
  });
});
