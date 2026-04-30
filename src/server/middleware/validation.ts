import { Request, Response, NextFunction } from 'express';

export interface APIError {
  code: string;
  message: string;
  details?: unknown;
  suggestion?: string;
}

export interface FieldRule {
  field: string;
  required?: boolean;
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
}

export function validateBody(rules: FieldRule[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: string[] = [];

    for (const rule of rules) {
      const value = req.body?.[rule.field];

      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push(`Field "${rule.field}" is required`);
        continue;
      }

      if (value !== undefined && value !== null && rule.type) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== rule.type) {
          errors.push(`Field "${rule.field}" must be of type ${rule.type}, got ${actualType}`);
        }
      }
    }

    if (errors.length > 0) {
      const apiError: APIError = {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: errors,
      };
      res.status(400).json(apiError);
      return;
    }

    next();
  };
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  const apiError: APIError = {
    code: 'INTERNAL_ERROR',
    message: err.message || 'An unexpected error occurred',
  };
  res.status(500).json(apiError);
}
