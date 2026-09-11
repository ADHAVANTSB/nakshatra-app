import { RecordStatus } from './common.model';

export interface Caretaker {
  id: string;
  shelterHomeId: string;
  name: string;
  phone: string;
  alternativePhone?: string;
  status: RecordStatus;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
