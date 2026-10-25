// Browser-safe types. A ticket contains order facts, never audio or transcripts.
export interface DemoTicket {
  ticketId: string;
  label: "DEMO";
  kind: "order";
  status: "pending_acceptance";
  demo: true;
  staffAccepted: false;
  menuApproved: boolean;
  createdAt: string;
  sourceBuild: string;
  customerName: string;
  callback: "[redacted]" | "not provided";
  orderType: "pickup";
  payment: "at pickup";
  tax: "not configured";
  items: {name:string;qty:number;size?:string;spice?:string;notes:string[];lineTotalCents:number;sizeVerified?:boolean}[];
  subtotalCents: number;
  notes: string[];
  email: {status:"disabled"|"not_configured"|"sending"|"provider_accepted"|"failed";provider:"resend";reason?:"configuration"|"timeout"|"provider"|"network"};
  sms: {status:"disabled"|"simulated";sent:false;text:string};
}
