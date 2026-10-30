export interface PaginationMeta {
  total: number;

  limit: number;

  offset: number;
}

export interface PaginatedResult<T> extends PaginationMeta {
  items: T[];
}

export interface ResponseError {
  code: string;

  message: string;

  field?: string;
}

export interface ApiResponse<T> {
  statusCode: number;

  message: string;

  data: T | null;

  meta: Partial<PaginationMeta>;

  errors: ResponseError[];
}
