/**
 * Demo slides for rehearsing the stage presentation without real
 * results. Every slide is source 'DEMO', so isVerifiedWinner() is
 * false for all of them and the demo banner can never be mistaken
 * for an official winner announcement.
 */

import { StageSlide } from './stage-slide';

export const DEMO_DATA_NOTICE = 'DEMO DATA — NOT OFFICIAL RESULTS';

export const DEMO_SLIDES: StageSlide[] = [
  {
    id: 'DEMO-S1',
    eventId: 'DEMO-E1',
    eventCode: 'DEMO-01',
    eventName: 'Group Dance',
    mode: 'GROUP',
    position: 'FIRST',
    homeName: 'Rainbow Children Home',
    childName: '',
    teamName: '',
    subtitle: '',
    source: 'DEMO',
  },
  {
    id: 'DEMO-S2',
    eventId: 'DEMO-E2',
    eventCode: 'DEMO-02',
    eventName: 'Group Song',
    mode: 'GROUP',
    position: 'SECOND',
    homeName: 'Little Hearts Home',
    childName: '',
    teamName: '',
    subtitle: '',
    source: 'DEMO',
  },
  {
    id: 'DEMO-S3',
    eventId: 'DEMO-E3',
    eventCode: 'DEMO-03',
    eventName: 'Story Telling',
    mode: 'SOLO',
    position: 'THIRD',
    homeName: 'Rainbow Children Home',
    childName: 'Ananya',
    teamName: '',
    subtitle: '',
    source: 'DEMO',
  },
  {
    id: 'DEMO-S4',
    eventId: 'DEMO-E4',
    eventCode: 'DEMO-04',
    eventName: 'Quiz (Junior)',
    mode: 'SOLO',
    position: 'FIRST',
    homeName: 'Sunrise Home',
    childName: 'Karthik',
    teamName: '',
    subtitle: '',
    source: 'DEMO',
  },
  {
    id: 'DEMO-S5',
    eventId: 'DEMO-E5',
    eventCode: 'DEMO-05',
    eventName: 'Skit (Tamil)',
    mode: 'GROUP',
    position: 'SECOND',
    homeName: 'Hope Children Home',
    childName: '',
    teamName: '',
    subtitle: '',
    source: 'DEMO',
  },
];
