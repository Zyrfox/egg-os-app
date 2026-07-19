import { z } from 'zod'

const EvidenceContentType = z.enum(['image/jpeg', 'image/png', 'application/pdf'])
const RecordType = z.enum(['daily_report', 'task'])

export const RequestUploadReq = z
  .object({
    record_type: RecordType,
    record_id: z.string().uuid(),
    file_name: z.string().min(1).max(255),
    content_type: EvidenceContentType,
    file_size: z.number().int().min(1).max(10 * 1024 * 1024),
  })
  .transform((v) => ({
    recordType: v.record_type as 'daily_report' | 'task',
    recordId: v.record_id,
    fileName: v.file_name,
    contentType: v.content_type as 'image/jpeg' | 'image/png' | 'application/pdf',
    fileSize: v.file_size,
  }))

export const EvidenceParams = z.object({
  id: z.string().uuid(),
})

export const ListEvidenceQuery = z
  .object({
    record_type: RecordType,
    record_id: z.string().uuid(),
  })
  .transform((v) => ({
    recordType: v.record_type as 'daily_report' | 'task',
    recordId: v.record_id,
  }))

export type RequestUploadInput = z.infer<typeof RequestUploadReq>
export type EvidenceParamsInput = z.infer<typeof EvidenceParams>
export type ListEvidenceQueryInput = z.infer<typeof ListEvidenceQuery>
