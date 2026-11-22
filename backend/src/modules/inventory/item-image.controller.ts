import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { grantsOf, may } from '../../common/warehouse/warehouse-access';
import { LOGO_UPLOAD_MAX_BYTES, logoMimeForUpload } from '../company/company.service';
import { ITEM_IMAGE_MAX_BYTES, ItemImageService } from './item-image.service';

type Upload = { buffer: Buffer; mimetype: string; originalname: string };

/**
 * Item pictures. Reading is part of reading the catalogue; writing is part of
 * maintaining it, so the existing item permissions apply unchanged.
 *
 * The routes hang off the item id, and every one of them proves the item is
 * visible to this caller's warehouse grants before answering — a picture is
 * inventory data, and a storekeeper restricted to one shelf has no business
 * seeing the catalogue of another.
 */
@Controller('inventory/items/:itemId/image')
export class ItemImageController {
  constructor(private readonly images: ItemImageService) {}

  @Get()
  @RequirePermissions('inventory.items.read')
  async get(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertWarehouseScope(user);
    response.setHeader('Cache-Control', 'private, no-store');
    return this.images.get(user.companyId, itemId);
  }

  @Post()
  @RequirePermissions('inventory.items.create', 'inventory.items.update')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: LOGO_UPLOAD_MAX_BYTES, files: 1, fields: 1, fieldSize: 128, parts: 2 },
    }),
  )
  set(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @UploadedFile() file?: Upload,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No image file was uploaded / لم يتم إرسال صورة.');
    }
    // A storekeeper restricted to one shelf must not write into the catalogue
    // of another, and the class contract promises the check on every route.
    this.assertWarehouseScope(user);
    // The declared type and name are hints; normalizePicture re-checks the magic
    // bytes and re-encodes before anything is stored.
    const mime = logoMimeForUpload(file.mimetype, file.originalname);
    return this.images.set(user.companyId, user.userId, itemId, file.buffer, mime);
  }

  @Delete()
  @RequirePermissions('inventory.items.update')
  remove(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    this.assertWarehouseScope(user);
    return this.images.remove(user.companyId, user.userId, itemId);
  }

  /// Used by list screens to decide whether to ask for a picture at all.
  @Get('presence')
  @RequirePermissions('inventory.items.read')
  async presence(@CurrentUser() user: AuthUser, @Query('itemIds') itemIds?: string) {
    this.assertWarehouseScope(user);
    const ids = String(itemIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    return { itemIds: [...(await this.images.presence(user.companyId, ids))] };
  }

  /// With no grants the caller sees the whole catalogue. With grants, a picture
  /// is only theirs if they may at least view a warehouse — the picture itself
  /// is not tied to a shelf, so viewing any granted warehouse is the test.
  private assertWarehouseScope(user: AuthUser) {
    const grants = grantsOf(user);
    if (grants === null) return;
    const mightView = grants.some((grant) => may(user, grant.warehouseId, 'view'));
    if (!mightView) {
      throw new BadRequestException(
        'لا تملك صلاحية عرض أصناف أي مستودع / You may not view the catalogue of any warehouse.',
      );
    }
  }
}

/** The maximum upload accepted by the interceptor, exported for the tests. */
export const ITEM_IMAGE_UPLOAD_MAX = ITEM_IMAGE_MAX_BYTES;

/// Answers for the catalogue as a whole, so it cannot hang off one item's path.
/// A list needs to know which rows to draw a picture on; asking per row would
/// be one request per item. Only ids come back - the bytes are fetched later,
/// and only for the rows that have them.
@Controller('inventory/items')
export class ItemPictureIndexController {
  constructor(private readonly images: ItemImageService) {}

  /// `?itemIds=a,b,c` - the rows on the page the caller is already drawing.
  /// Ids not belonging to this company simply produce no answer.
  @Get('with-picture')
  @RequirePermissions('inventory.items.read')
  async withPicture(@CurrentUser() user: AuthUser, @Query('itemIds') itemIds?: string) {
    const grants = grantsOf(user);
    if (grants !== null && !grants.some((grant) => may(user, grant.warehouseId, 'view'))) {
      throw new BadRequestException(
        'لا تملك صلاحية عرض أصناف أي مستودع / You may not view the catalogue of any warehouse.',
      );
    }
    const ids = String(itemIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    return { pictures: await this.images.thumbnails(user.companyId, ids) };
  }
}
