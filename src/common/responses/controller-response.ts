import { PaginationMeta } from './api-response';

export interface ControllerResponse<T = unknown> {
  data: T;

  message: string;

  meta?: Partial<PaginationMeta>;
}

// keyof exposes public members, so new endpoint methods are checked automatically.
// Private helpers and injected services are not part of this contract.
export type ControllerContract<TController> = {
  [Key in keyof TController]: TController[Key] extends (...args: infer Args) => unknown
    ? (...args: Args) => ControllerResponse | Promise<ControllerResponse>
    : TController[Key];
};
