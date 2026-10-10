import type { Request } from 'express';
import type { Prisma } from 'prisma-client';
import { generatePaginationData } from '@/helper/paginationHelper';
import type { PaginationQueryType } from '../../helper/paginationSchema';
import { prisma } from '../../lib/prisma';
import { BadRequestError } from '../../utils/BadRequestError';
import { NotFoundError } from '../../utils/NotFoundError';
import type { CreateDonorType, GetAllDonorsQueryType, UpdateDonorType } from './donor.schema';

export async function createDonorService(data: CreateDonorType) {
  const { name, email, phoneNo } = data.body;

  const existingDonor = await prisma.user.findFirst({
    where: {
      OR: [{ email: email || undefined }, ...(phoneNo ? [{ phone: phoneNo }] : [])],
      roleId: 2,
      isDeleted: false
    },
  });

  if (existingDonor) {
    throw new BadRequestError('A donor with this email or phone number already exists');
  }

  return prisma.user.create({
    data: {
      name,
      email,
      phone: phoneNo ?? '',
      password: '', // placeholder, since users need passwords now
      roleId: 2,
    },
  });
}

export async function getAllDonorsService(
  req: Request,
  query: GetAllDonorsQueryType['query'],
  pagination: PaginationQueryType
) {
  const { name, email, phoneNo } = query;
  const { page, limit } = pagination;

  const where: Prisma.UserWhereInput = { roleId: 2, isDeleted: false };

  if (name && name.trim() !== '') where.name = { contains: name.trim() };
  if (email && email.trim() !== '') where.email = { contains: email.trim() };
  if (phoneNo && phoneNo.trim() !== '') where.phone = { contains: phoneNo.trim() };

  const [donors, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
  ]);

  const paginationData = generatePaginationData(req, total, page, limit);

  return { donors, pagination: paginationData };
}

export async function getDonorByIdService(id: number) {
  const donor = await prisma.user.findUnique({
    where: { id },
  });
  if (!donor || donor.roleId !== 2 || donor.isDeleted) throw new NotFoundError('Donor not found');
  return donor;
}

export async function updateDonorService(id: number, data: UpdateDonorType) {
  const { name, email, phoneNo } = data.body;
  const donor = await prisma.user.findUnique({ where: { id } });
  if (!donor || donor.roleId !== 2 || donor.isDeleted) throw new NotFoundError('Donor not found');

  return prisma.user.update({
    where: { id },
    data: {
      ...(name && { name }),
      ...(email && { email }),
      ...(phoneNo && { phone: phoneNo }),
    },
  });
}

export async function deleteDonorService(id: number) {
  const donor = await prisma.user.findUnique({ where: { id } });
  if (!donor || donor.roleId !== 2 || donor.isDeleted) throw new NotFoundError('Donor not found');

  return prisma.user.update({ where: { id }, data: { isDeleted: true } });
}
