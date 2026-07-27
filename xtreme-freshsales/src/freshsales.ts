export class FreshsalesError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'FreshsalesError';
  }
}

export type JsonObject = Record<string, unknown>;
export type TargetableType = 'Contact' | 'SalesAccount' | 'Deal';
export type EntityType = 'contacts' | 'sales_accounts' | 'deals';

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

export class FreshsalesClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/${path.replace(/^\//, '')}`);
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await this.fetchImpl(url, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Token token=${this.apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      throw new FreshsalesError(`Freshsales request failed (${response.status})`, response.status, data);
    }
    return data as T;
  }

  healthCheck() {
    return this.request('contacts/filters');
  }

  search(query: string, include = 'contact,sales_account,deal', perPage = 25) {
    return this.request('search', {
      query: { q: query, include, per_page: Math.min(perPage, 100) }
    });
  }

  searchContacts(query: string, perPage = 25) {
    return this.search(query, 'contact', perPage);
  }

  getEntity(entity: EntityType, id: number) {
    const includes: Record<EntityType, string> = {
      contacts: 'owner,source,campaign,tasks,appointments,notes,deals,sales_accounts',
      sales_accounts: 'owner,contacts,deals,tasks,appointments,notes',
      deals: 'owner,source,contacts,sales_account,deal_stage,deal_type,deal_reason,campaign,sales_activities,tasks,appointments,notes'
    };
    return this.request(`${entity}/${id}`, { query: { include: includes[entity] } });
  }

  createEntity(entity: EntityType, fields: JsonObject) {
    const root = entity === 'sales_accounts' ? 'sales_account' : entity.slice(0, -1);
    return this.request(entity, { method: 'POST', body: { [root]: fields } });
  }

  updateEntity(entity: EntityType, id: number, fields: JsonObject) {
    const root = entity === 'sales_accounts' ? 'sales_account' : entity.slice(0, -1);
    return this.request(`${entity}/${id}`, { method: 'PUT', body: { [root]: fields } });
  }

  deleteEntity(entity: EntityType, id: number) {
    return this.request(`${entity}/${id}`, { method: 'DELETE' });
  }

  upsertContact(uniqueIdentifier: JsonObject, fields: JsonObject) {
    return this.request('contacts/upsert', {
      method: 'POST',
      body: { unique_identifier: uniqueIdentifier, contact: fields }
    });
  }

  bulkUpsertContacts(contacts: JsonObject[]) {
    return this.request('contacts/bulk_upsert', {
      method: 'POST',
      body: { contacts }
    });
  }

  bulkUpsertAccounts(accounts: JsonObject[]) {
    return this.request('sales_accounts/bulk_upsert', {
      method: 'POST',
      body: { sales_accounts: accounts }
    });
  }

  getJobStatus(jobId: string) {
    return this.request(`job_statuses/${encodeURIComponent(jobId)}`);
  }

  getConversations(targetType: 'contacts' | 'sales_accounts', id: number, page = 1, perPage = 25) {
    return this.request(`${targetType}/${id}/conversations`, {
      query: {
        include: 'email_conversation_recipients,targetable,phone_number,phone_caller,note,user',
        page,
        per_page: Math.min(perPage, 100)
      }
    });
  }

  listFilters(entity: EntityType) {
    return this.request(`${entity}/filters`);
  }

  listEntityView(entity: EntityType, viewId: number, page = 1, perPage = 100) {
    return this.request(`${entity}/view/${viewId}`, {
      query: { page, per_page: Math.min(perPage, 100) }
    });
  }

  listFields(entity: EntityType | 'sales_activities') {
    return this.request(`settings/${entity}/fields`, { query: { include: 'field_group' } });
  }

  getContact(contactId: number) {
    return this.getEntity('contacts', contactId);
  }

  listTasks(filter: string) {
    return this.request('tasks', { query: { filter, include: 'owner,targetable,users' } });
  }

  getTask(taskId: number) {
    return this.request(`tasks/${taskId}`, { query: { include: 'owner,targetable,users' } });
  }

  createTask(input: {
    targetableId: number;
    targetableType: TargetableType;
    ownerId: number;
    title: string;
    description?: string;
    dueDate: string;
    status?: number;
  }) {
    return this.request('tasks', {
      method: 'POST',
      body: {
        task: {
          title: input.title,
          description: input.description || '',
          due_date: input.dueDate,
          owner_id: input.ownerId,
          targetable_id: input.targetableId,
          targetable_type: input.targetableType,
          ...(input.status === undefined ? {} : { status: input.status }),
          task_users_attributes: [{ user_id: input.ownerId }]
        }
      }
    });
  }

  updateTask(taskId: number, fields: JsonObject) {
    return this.request(`tasks/${taskId}`, { method: 'PUT', body: { task: fields } });
  }

  deleteTask(taskId: number) {
    return this.request(`tasks/${taskId}`, { method: 'DELETE' });
  }

  listAppointments(filter: 'open' | 'completed') {
    return this.request('appointments', {
      query: { filter, include: 'creater,targetable,appointment_attendees' }
    });
  }

  getAppointment(appointmentId: number) {
    return this.request(`appointments/${appointmentId}`);
  }

  createAppointment(fields: JsonObject) {
    return this.request('appointments', { method: 'POST', body: { appointment: fields } });
  }

  updateAppointment(appointmentId: number, fields: JsonObject) {
    return this.request(`appointments/${appointmentId}`, {
      method: 'PUT',
      body: { appointment: fields }
    });
  }

  deleteAppointment(appointmentId: number) {
    return this.request(`appointments/${appointmentId}`, { method: 'DELETE' });
  }

  listSalesActivities(page = 1, perPage = 100) {
    return this.request('sales_activities', { query: { page, per_page: Math.min(perPage, 100) } });
  }

  getSalesActivity(activityId: number) {
    return this.request(`sales_activities/${activityId}`);
  }

  createSalesActivity(fields: JsonObject) {
    return this.request('sales_activities', {
      method: 'POST',
      body: { sales_activity: fields }
    });
  }

  updateSalesActivity(activityId: number, fields: JsonObject) {
    return this.request(`sales_activities/${activityId}`, {
      method: 'PUT',
      body: { sales_activity: fields }
    });
  }

  deleteSalesActivity(activityId: number) {
    return this.request(`sales_activities/${activityId}`, { method: 'DELETE' });
  }

  listUsers() {
    return this.request('selector/owners');
  }

  listSalesActivityTypes() {
    return this.request('selector/sales_activity_types');
  }

  addNote(targetableId: number, targetableType: TargetableType, description: string) {
    return this.request('notes', {
      method: 'POST',
      body: { note: { description, targetable_type: targetableType, targetable_id: targetableId } }
    });
  }

  updateNote(noteId: number, targetableId: number, targetableType: TargetableType, description: string) {
    return this.request(`notes/${noteId}`, {
      method: 'PUT',
      body: { note: { description, targetable_type: targetableType, targetable_id: targetableId } }
    });
  }

  deleteNote(noteId: number) {
    return this.request(`notes/${noteId}`, { method: 'DELETE' });
  }

  updateContact(contactId: number, fields: JsonObject, customFields?: JsonObject) {
    return this.updateEntity('contacts', contactId, {
      ...fields,
      ...(customFields ? { custom_field: customFields } : {})
    });
  }
}
