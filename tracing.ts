import { createAnalytics, WorkflowTracer } from '@afterspan/sdk';

const workflows: Record<string, string> = {
  '/v1/sms': 'otp_capture_sms', '/v1/email': 'otp_capture_email',
  '/v1/recent': 'otp_lookup', '/v1/claim': 'otp_claim',
  '/v1/history': 'otp_history', '/v1/observation': 'otp_observation',
  '/v1/source-heartbeat': 'otp_source_heartbeat',
};

// Only route names leave the service. Never inspect bodies, headers or OTP records.
export function traceBridge(handler: (request: Request) => Promise<Response>, config = {
  url: process.env.NATIVE_ANALYTICS_URL, writeKey: process.env.NATIVE_ANALYTICS_WRITE_KEY,
}) {
  let tracer: WorkflowTracer | undefined;
  try { if (config.url && config.writeKey) tracer = new WorkflowTracer(createAnalytics(config)); } catch {}
  return async (request: Request): Promise<Response> => {
    const workflow = workflows[new URL(request.url).pathname];
    if (!tracer || !workflow) return handler(request);
    const result = await tracer.response({ workflow, environment: process.env.RAILWAY_ENVIRONMENT_NAME === 'production' ? 'production' : 'development' }, () => handler(request));
    void result.finished.then(() => tracer!.flush()).catch(() => undefined);
    return result.response;
  };
}
