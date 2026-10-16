/* One-off: replace the event dropdowns on the Scoring and Attendance pages
   with clickable event chip grids. */
const fs = require('fs');

function replaceSelect(file, marker, chipGrid) {
  let s = fs.readFileSync(file, 'utf8');
  const start = s.indexOf(marker);
  if (start === -1) { console.log(file + ': select marker not found'); return; }
  const endTag = '</select>';
  const end = s.indexOf(endTag, start);
  if (end === -1) { console.log(file + ': </select> not found'); return; }
  s = s.slice(0, start) + chipGrid + s.slice(end + endTag.length);
  fs.writeFileSync(file, s);
  console.log(file + ': select replaced with chip grid');
}

const scoringGrid = [
  '    <div class="event-chip-grid" role="group" aria-label="Choose an active event">',
  '      @for (event of events(); track event.id) {',
  '        @if (event.status === \'ACTIVE\') {',
  '          <button type="button" class="event-chip" [class.selected]="event.id === selectedEventId()" (click)="setEvent(event.id)">',
  '            <strong>{{ event.name }}</strong>',
  '            <span>{{ event.eventCode }}</span>',
  '          </button>',
  '        }',
  '      }',
  '    </div>',
].join('\n');

const attendanceGrid = [
  '  <div class="event-chip-grid" role="group" aria-label="Choose an active event">',
  '    @for (event of events(); track event.id) {',
  '      @if (event.status === \'ACTIVE\') {',
  '        <button type="button" class="event-chip" [class.selected]="event.id === selectedEventId()" (click)="setEvent(event.id)">',
  '          <strong>{{ event.name }}</strong>',
  '          <span>{{ event.eventCode }}</span>',
  '        </button>',
  '      }',
  '    }',
  '  </div>',
].join('\n');

replaceSelect('src/app/pages/scoring/scoring.html', '    <select', scoringGrid);
replaceSelect('src/app/pages/attendance/attendance.html', '<select id="attendance-event"', attendanceGrid);
