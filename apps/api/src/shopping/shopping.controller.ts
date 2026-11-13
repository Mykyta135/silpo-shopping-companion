import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type {
  AddToCartRequest,
  AddToCartResponse,
  AisleEventRequest,
  AisleEventResponse,
  BuildListRequest,
  ListResponse,
  PatchListRequest,
} from '@silpo/shared';
import { SilpoAuthorizationRequired } from '../mcp/silpo-mcp.service.js';
import { ShoppingService } from './shopping.service.js';

@Controller('shopping')
export class ShoppingController {
  constructor(private readonly shopping: ShoppingService) {}

  /** Zone catalogue, so the client can render the route skeleton. */
  @Get('zones')
  zones() {
    return this.shopping.zones();
  }

  /** Phase 1: the agent assembles a list from receipts, coupons and prices. */
  @Post('list')
  @UseGuards(ThrottlerGuard) // starts a paid LLM call, see ai-rate-limit.ts
  list(@Body() body: BuildListRequest): Promise<ListResponse> {
    if (!body?.sessionId) throw new BadRequestException('sessionId is required');
    return this.run(async () => {
      const list = await this.shopping.buildList(body.sessionId, body.request);
      return {
        list,
        route: this.shopping.buildRouteFor(list),
        progress: this.shopping.progressFor(list),
      };
    });
  }

  @Get('list')
  getList(@Query('sessionId') sessionId: string): Promise<ListResponse> {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    return this.run(async () => {
      const list = await this.shopping.getList(sessionId);
      return {
        list,
        route: this.shopping.buildRouteFor(list),
        progress: this.shopping.progressFor(list),
      };
    });
  }

  /** Guest edits the agent's proposal — their words win. */
  @Patch('list')
  patch(@Body() body: PatchListRequest): Promise<ListResponse> {
    if (!body?.sessionId) throw new BadRequestException('sessionId is required');
    if (!body.add?.title && !body.removeId && !body.choose && !body.currentZone) {
      throw new BadRequestException(
        'add.title, removeId, choose or currentZone is required',
      );
    }
    if (body.choose && (!body.choose.itemId || !body.choose.productId)) {
      throw new BadRequestException('choose requires itemId and productId');
    }
    return this.run(async () => {
      const list = await this.shopping.patchList(body.sessionId, body);
      return {
        list,
        route: this.shopping.buildRouteFor(list),
        progress: this.shopping.progressFor(list),
      };
    });
  }

  /** Phase 2: something happened in the aisle — the agent may react, or not. */
  @Post('event')
  @UseGuards(ThrottlerGuard) // the agent may react with a paid LLM call
  event(@Body() body: AisleEventRequest): Promise<AisleEventResponse> {
    if (!body?.sessionId) throw new BadRequestException('sessionId is required');
    if (!body?.type) throw new BadRequestException('type is required');
    if ((body.type === 'picked' || body.type === 'missing') && !body.itemId) {
      throw new BadRequestException(`itemId is required for '${body.type}'`);
    }
    if (body.type === 'zone-left' && !body.zone) {
      throw new BadRequestException("zone is required for 'zone-left'");
    }

    return this.run(async () => {
      const { list, reaction } = await this.shopping.handleEvent(body.sessionId, body);
      return {
        list,
        route: this.shopping.buildRouteFor(list),
        progress: this.shopping.progressFor(list),
        reaction,
      };
    });
  }

  /** Writes the chosen products into the guest's real Silpo cart. */
  @Post('cart')
  cart(@Body() body: AddToCartRequest): Promise<AddToCartResponse> {
    if (!body?.sessionId) throw new BadRequestException('sessionId is required');
    return this.run(async () => {
      const { list, added, checkoutUrl, total, warnings } =
        await this.shopping.addToCart(body.sessionId, body.itemIds);
      return {
        list,
        route: this.shopping.buildRouteFor(list),
        progress: this.shopping.progressFor(list),
        added,
        checkoutUrl,
        total,
        warnings,
      };
    });
  }

  @Delete('list')
  async reset(@Query('sessionId') sessionId: string): Promise<{ ok: true }> {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    await this.shopping.reset(sessionId);
    return { ok: true };
  }

  /**
   * Translates infrastructure failures into messages a guest standing in an
   * aisle can act on. Left raw, an Anthropic billing error surfaces as a blank
   * response and the app just appears to hang.
   */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof SilpoAuthorizationRequired) {
        throw new UnauthorizedException({
          message: 'Silpo authorization required',
          authorizationUrl: err.authorizationUrl,
        });
      }

      const message = err instanceof Error ? err.message : String(err);
      if (/credit balance|quota|rate limit|insufficient/i.test(message)) {
        throw new ServiceUnavailableException(
          'AI-помічник тимчасово недоступний. Список збережено — спробуй за хвилину.',
        );
      }

      throw err;
    }
  }
}
