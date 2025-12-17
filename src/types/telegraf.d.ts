import "telegraf";

declare module "telegraf" {
  interface Context {
    answerCbQuery(...args: any[]): Promise<any>;
  }
}
