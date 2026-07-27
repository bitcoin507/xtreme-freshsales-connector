import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FreshsalesClient, FreshsalesError, type EntityType, type JsonObject } from './freshsales.js';

const entitySchema = z.enum(['contacts', 'sales_accounts', 'deals']);
const targetableSchema = z.enum(['Contact', 'SalesAccount', 'Deal']);
const fieldsSchema = z.record(z.string(), z.unknown()).describe(
  'Freshsales field names and values. Discover fields first when custom fields or IDs are uncertain.'
);
const readAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const updateAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const deleteAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

function result(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: { result: data }
  };
}

function failure(error: unknown) {
  const data = error instanceof FreshsalesError
    ? { error: error.message, status: error.status, details: error.details }
    : { error: error instanceof Error ? error.message : String(error) };
  return { ...result(data), isError: true };
}

async function run(operation: () => Promise<unknown>) {
  try {
    return result(await operation());
  } catch (error) {
    return failure(error);
  }
}

export function createServer(client: FreshsalesClient): McpServer {
  const server = new McpServer({ name: 'xtreme-freshsales', version: '0.2.0' });

  server.registerTool('freshsales_connection_status', {
    title: 'Check Freshsales connection',
    description: 'Verify that the private Xtreme Disaster Freshsales connection is working.',
    inputSchema: {},
    annotations: readAnnotations
  }, () => run(async () => ({ connected: Boolean(await client.healthCheck()) })));

  server.registerTool('search_freshsales', {
    title: 'Search Freshsales',
    description: 'Search contacts, companies, and deals by name, email, phone, company, or keyword.',
    inputSchema: {
      query: z.string().min(2).max(200),
      include: z.array(z.enum(['contact', 'sales_account', 'deal'])).min(1).max(3)
        .default(['contact', 'sales_account', 'deal']),
      limit: z.number().int().min(1).max(100).default(25)
    },
    annotations: readAnnotations
  }, ({ query, include, limit }) => run(() => client.search(query, include.join(','), limit)));

  server.registerTool('get_freshsales_record', {
    title: 'Get a Freshsales record',
    description: 'Retrieve one contact, company, or deal with its available relationships and activity context.',
    inputSchema: {
      entity: entitySchema,
      record_id: z.number().int().positive()
    },
    annotations: readAnnotations
  }, ({ entity, record_id }) => run(() => client.getEntity(entity, record_id)));

  server.registerTool('list_freshsales_records', {
    title: 'List Freshsales records',
    description: 'List contacts, companies, or deals from a Freshsales saved view. Discover view IDs with list_freshsales_filters first.',
    inputSchema: {
      entity: entitySchema,
      view_id: z.number().int().positive(),
      page: z.number().int().positive().default(1),
      per_page: z.number().int().min(1).max(100).default(100)
    },
    annotations: readAnnotations
  }, ({ entity, view_id, page, per_page }) => run(() => client.listEntityView(entity, view_id, page, per_page)));

  server.registerTool('list_freshsales_filters', {
    title: 'List Freshsales saved views',
    description: 'List saved-view/filter IDs for contacts, companies, or deals.',
    inputSchema: { entity: entitySchema },
    annotations: readAnnotations
  }, ({ entity }) => run(() => client.listFilters(entity)));

  server.registerTool('list_freshsales_fields', {
    title: 'List Freshsales fields',
    description: 'Discover standard fields, custom fields, choices, deal stages, pipelines, and activity fields before creating or updating records.',
    inputSchema: {
      entity: z.enum(['contacts', 'sales_accounts', 'deals', 'sales_activities'])
    },
    annotations: readAnnotations
  }, ({ entity }) => run(() => client.listFields(entity)));

  server.registerTool('get_freshsales_conversations', {
    title: 'Get Freshsales conversations',
    description: 'Retrieve logged email, phone, and note conversation history for a contact or company.',
    inputSchema: {
      entity: z.enum(['contacts', 'sales_accounts']),
      record_id: z.number().int().positive(),
      page: z.number().int().positive().default(1),
      per_page: z.number().int().min(1).max(100).default(25)
    },
    annotations: readAnnotations
  }, ({ entity, record_id, page, per_page }) => run(() => client.getConversations(entity, record_id, page, per_page)));

  server.registerTool('list_freshsales_users', {
    title: 'List Freshsales users',
    description: 'List CRM owners so records and tasks can be assigned to the correct user ID.',
    inputSchema: {},
    annotations: readAnnotations
  }, () => run(() => client.listUsers()));

  server.registerTool('list_freshsales_activity_types', {
    title: 'List Freshsales activity types',
    description: 'Map sales activity type IDs and outcomes for logging calls, meetings, visits, and KPI activity.',
    inputSchema: {},
    annotations: readAnnotations
  }, () => run(() => client.listSalesActivityTypes()));

  server.registerTool('create_freshsales_record', {
    title: 'Create a Freshsales record',
    description: 'Create one contact, company, or deal after searching for duplicates. This changes CRM data and requires confirmation.',
    inputSchema: {
      entity: entitySchema,
      fields: fieldsSchema
    },
    annotations: writeAnnotations
  }, ({ entity, fields }) => run(() => client.createEntity(entity, fields)));

  server.registerTool('update_freshsales_record', {
    title: 'Update a Freshsales record',
    description: 'Update one inspected contact, company, or deal. This changes CRM data and requires confirmation.',
    inputSchema: {
      entity: entitySchema,
      record_id: z.number().int().positive(),
      fields: fieldsSchema
    },
    annotations: updateAnnotations
  }, ({ entity, record_id, fields }) => run(() => client.updateEntity(entity, record_id, fields)));

  server.registerTool('upsert_freshsales_contact', {
    title: 'Create or update a Freshsales contact',
    description: 'Deduplicate and upsert one contact using a unique email or record ID. This changes CRM data and requires confirmation.',
    inputSchema: {
      unique_identifier: z.record(z.string(), z.union([z.string(), z.number()])).refine(
        value => Object.keys(value).length === 1,
        'Provide exactly one unique identifier, normally {"emails":"name@example.com"} or {"id":123}.'
      ),
      fields: fieldsSchema
    },
    annotations: writeAnnotations
  }, ({ unique_identifier, fields }) => run(() => client.upsertContact(unique_identifier, fields)));

  server.registerTool('bulk_upsert_freshsales_contacts', {
    title: 'Bulk import Freshsales contacts',
    description: 'Bulk create or update up to 100 deduplicated contacts. Each item must contain one unique identifier plus a data object. This bulk change requires explicit confirmation.',
    inputSchema: {
      contacts: z.array(fieldsSchema).min(1).max(100)
    },
    annotations: writeAnnotations
  }, ({ contacts }) => run(() => client.bulkUpsertContacts(contacts)));

  server.registerTool('bulk_upsert_freshsales_companies', {
    title: 'Bulk import Freshsales companies',
    description: 'Bulk create or update up to 100 deduplicated companies. Each item must contain one unique identifier plus a data object. This bulk change requires explicit confirmation.',
    inputSchema: {
      companies: z.array(fieldsSchema).min(1).max(100)
    },
    annotations: writeAnnotations
  }, ({ companies }) => run(() => client.bulkUpsertAccounts(companies)));

  server.registerTool('get_freshsales_import_status', {
    title: 'Check Freshsales import status',
    description: 'Check a Freshsales bulk-upsert job using the job ID returned by an import operation.',
    inputSchema: { job_id: z.string().min(1).max(300) },
    annotations: readAnnotations
  }, ({ job_id }) => run(() => client.getJobStatus(job_id)));

  server.registerTool('delete_freshsales_record', {
    title: 'Delete a Freshsales record',
    description: 'Delete exactly one previously inspected contact, company, or deal. This is destructive and requires explicit confirmation with the record name and ID.',
    inputSchema: {
      entity: entitySchema,
      record_id: z.number().int().positive(),
      confirmation_name: z.string().min(1).max(255).describe('The record name shown to and confirmed by the user.')
    },
    annotations: deleteAnnotations
  }, ({ entity, record_id }) => run(() => client.deleteEntity(entity, record_id)));

  server.registerTool('list_freshsales_tasks', {
    title: 'List Freshsales tasks',
    description: 'List open, due today, due tomorrow, overdue, or completed tasks.',
    inputSchema: {
      filter: z.enum(['open', 'due_today', 'due_tomorrow', 'overdue', 'completed']).default('open')
    },
    annotations: readAnnotations
  }, ({ filter }) => run(() => client.listTasks(filter)));

  server.registerTool('get_freshsales_task', {
    title: 'Get a Freshsales task',
    description: 'Retrieve one task with owner and related CRM record context.',
    inputSchema: { task_id: z.number().int().positive() },
    annotations: readAnnotations
  }, ({ task_id }) => run(() => client.getTask(task_id)));

  server.registerTool('create_freshsales_task', {
    title: 'Create a Freshsales task',
    description: 'Create and assign a task for a contact, company, or deal. This changes CRM data and requires confirmation.',
    inputSchema: {
      targetable_id: z.number().int().positive(),
      targetable_type: targetableSchema,
      owner_id: z.number().int().positive(),
      title: z.string().min(1).max(255),
      description: z.string().max(10_000).optional(),
      due_date: z.string().datetime({ offset: true }),
      status: z.enum(['open', 'completed']).default('open')
    },
    annotations: writeAnnotations
  }, ({ targetable_id, targetable_type, owner_id, title, description, due_date, status }) => run(() => client.createTask({
    targetableId: targetable_id,
    targetableType: targetable_type,
    ownerId: owner_id,
    title,
    description,
    dueDate: due_date,
    status: status === 'completed' ? 1 : 0
  })));

  server.registerTool('update_freshsales_task', {
    title: 'Update a Freshsales task',
    description: 'Reschedule, reassign, edit, or complete one inspected task. This changes CRM data and requires confirmation.',
    inputSchema: {
      task_id: z.number().int().positive(),
      fields: fieldsSchema
    },
    annotations: updateAnnotations
  }, ({ task_id, fields }) => run(() => client.updateTask(task_id, fields)));

  server.registerTool('delete_freshsales_task', {
    title: 'Delete a Freshsales task',
    description: 'Delete exactly one inspected task. This is destructive and requires explicit confirmation.',
    inputSchema: {
      task_id: z.number().int().positive(),
      confirmation_title: z.string().min(1).max(255)
    },
    annotations: deleteAnnotations
  }, ({ task_id }) => run(() => client.deleteTask(task_id)));

  server.registerTool('list_freshsales_appointments', {
    title: 'List Freshsales appointments',
    description: 'List upcoming/open or completed appointments with related records and attendees.',
    inputSchema: { filter: z.enum(['open', 'completed']).default('open') },
    annotations: readAnnotations
  }, ({ filter }) => run(() => client.listAppointments(filter)));

  server.registerTool('get_freshsales_appointment', {
    title: 'Get a Freshsales appointment',
    description: 'Retrieve one Freshsales appointment and its attendees.',
    inputSchema: { appointment_id: z.number().int().positive() },
    annotations: readAnnotations
  }, ({ appointment_id }) => run(() => client.getAppointment(appointment_id)));

  server.registerTool('create_freshsales_appointment', {
    title: 'Create a Freshsales appointment',
    description: 'Create a CRM appointment for a contact, company, or deal. This can notify attendees and requires explicit confirmation of date, time, timezone, attendees, and location.',
    inputSchema: {
      title: z.string().min(1).max(255),
      description: z.string().max(10_000).optional(),
      from_date: z.string().datetime({ offset: true }),
      end_date: z.string().datetime({ offset: true }),
      time_zone: z.string().min(1).max(100),
      location: z.string().max(500).optional(),
      targetable_id: z.number().int().positive(),
      targetable_type: targetableSchema,
      appointment_attendees_attributes: z.array(z.object({
        attendee_type: z.enum(['FdMultitenant::User', 'Contact']),
        attendee_id: z.number().int().positive()
      })).max(50).default([])
    },
    annotations: writeAnnotations
  }, input => run(() => client.createAppointment(input)));

  server.registerTool('update_freshsales_appointment', {
    title: 'Update a Freshsales appointment',
    description: 'Update or reschedule one inspected appointment. This can notify attendees and requires explicit confirmation.',
    inputSchema: {
      appointment_id: z.number().int().positive(),
      fields: fieldsSchema
    },
    annotations: updateAnnotations
  }, ({ appointment_id, fields }) => run(() => client.updateAppointment(appointment_id, fields)));

  server.registerTool('delete_freshsales_appointment', {
    title: 'Delete a Freshsales appointment',
    description: 'Delete exactly one inspected appointment. This is destructive, may affect attendees, and requires explicit confirmation.',
    inputSchema: {
      appointment_id: z.number().int().positive(),
      confirmation_title: z.string().min(1).max(255)
    },
    annotations: deleteAnnotations
  }, ({ appointment_id }) => run(() => client.deleteAppointment(appointment_id)));

  server.registerTool('list_freshsales_sales_activities', {
    title: 'List Freshsales sales activities',
    description: 'List logged calls, meetings, visits, and other sales activities for KPI analysis.',
    inputSchema: {
      page: z.number().int().positive().default(1),
      per_page: z.number().int().min(1).max(100).default(100)
    },
    annotations: readAnnotations
  }, ({ page, per_page }) => run(() => client.listSalesActivities(page, per_page)));

  server.registerTool('get_freshsales_sales_activity', {
    title: 'Get a Freshsales sales activity',
    description: 'Retrieve one logged sales activity.',
    inputSchema: { activity_id: z.number().int().positive() },
    annotations: readAnnotations
  }, ({ activity_id }) => run(() => client.getSalesActivity(activity_id)));

  server.registerTool('create_freshsales_sales_activity', {
    title: 'Log a Freshsales sales activity',
    description: 'Log a call, meeting, visit, or other activity against a contact, company, or deal. This changes CRM data and requires confirmation.',
    inputSchema: {
      title: z.string().min(1).max(255),
      notes: z.string().max(10_000).optional(),
      targetable_id: z.number().int().positive(),
      targetable_type: targetableSchema,
      start_date: z.string().datetime({ offset: true }),
      end_date: z.string().datetime({ offset: true }),
      owner_id: z.number().int().positive(),
      sales_activity_type_id: z.number().int().positive(),
      sales_activity_outcome_id: z.number().int().positive().optional(),
      location: z.string().max(500).optional(),
      custom_field: fieldsSchema.optional()
    },
    annotations: writeAnnotations
  }, input => run(() => client.createSalesActivity(input)));

  server.registerTool('update_freshsales_sales_activity', {
    title: 'Update a Freshsales sales activity',
    description: 'Edit one inspected sales activity or record its outcome. This changes CRM data and requires confirmation.',
    inputSchema: {
      activity_id: z.number().int().positive(),
      fields: fieldsSchema
    },
    annotations: updateAnnotations
  }, ({ activity_id, fields }) => run(() => client.updateSalesActivity(activity_id, fields)));

  server.registerTool('delete_freshsales_sales_activity', {
    title: 'Delete a Freshsales sales activity',
    description: 'Delete exactly one inspected activity. This is destructive and requires explicit confirmation.',
    inputSchema: {
      activity_id: z.number().int().positive(),
      confirmation_title: z.string().min(1).max(255)
    },
    annotations: deleteAnnotations
  }, ({ activity_id }) => run(() => client.deleteSalesActivity(activity_id)));

  server.registerTool('add_freshsales_note', {
    title: 'Add a Freshsales note',
    description: 'Add a note to a contact, company, or deal. This changes CRM data and requires confirmation.',
    inputSchema: {
      targetable_id: z.number().int().positive(),
      targetable_type: targetableSchema,
      description: z.string().min(1).max(10_000)
    },
    annotations: writeAnnotations
  }, ({ targetable_id, targetable_type, description }) => run(() => client.addNote(targetable_id, targetable_type, description)));

  server.registerTool('update_freshsales_note', {
    title: 'Update a Freshsales note',
    description: 'Edit one inspected note. This changes CRM data and requires confirmation.',
    inputSchema: {
      note_id: z.number().int().positive(),
      targetable_id: z.number().int().positive(),
      targetable_type: targetableSchema,
      description: z.string().min(1).max(10_000)
    },
    annotations: updateAnnotations
  }, ({ note_id, targetable_id, targetable_type, description }) => run(
    () => client.updateNote(note_id, targetable_id, targetable_type, description)
  ));

  server.registerTool('delete_freshsales_note', {
    title: 'Delete a Freshsales note',
    description: 'Delete exactly one inspected note. This is destructive and requires explicit confirmation.',
    inputSchema: {
      note_id: z.number().int().positive(),
      confirmation_excerpt: z.string().min(1).max(255)
    },
    annotations: deleteAnnotations
  }, ({ note_id }) => run(() => client.deleteNote(note_id)));

  return server;
}
